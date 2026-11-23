/**
 * 安寄り買い。前日終値より gapMinPct 以上安く寄った銘柄を寄り付きの板寄せ（寄成）で買い、
 * gapStopPct 下げたら損切り、そうでなければ大引けの板寄せ（引成）で売る。
 *
 * 寄り付きと大引けの値は分足に入っていない日が多いので、日足の値（始値・安値・終値）で動かす。
 * 約定はその日の安値より必ず前なので、「安値が損切りの値以下なら損切り」で順番を間違えない。
 * 実際には寄り付く前に寄り値は分からず、寄り前の気配で判断することになる点は再現していない。
 */
import { monthly, summarizeDays } from "./backtest";
import type { BacktestResult, DayResult } from "./backtest";
import { closePosition, newDay } from "./engine";
import type { DailyBar } from "./gapstudy";
import { cleanPrice, hhmmToMinutes, jstMinutes, roundToTick, tickSize, usMarketClosed } from "./market";
import type { Bar, DayState, ExitReason, Position, Settings, Trade } from "./types";

/** その日ここまでの日足の値。prevClose は配当落ちを調整した前日終値 */
export interface OpenQuote {
  prevClose: number;
  open: number;
  low: number;
  close: number;
  /** その日が権利落ち日のときの1株あたり配当 */
  dividend?: number;
  /** 前日の終値が前々日の終値から何%動いたか（配当落ち調整済み）。前々日の足がなければ無い */
  prevReturnPct?: number;
}

/**
 * 日本の日付ごとに、その朝までに終わった直近の米国市場の前日比（%）を返す。米国の足は日付順。
 * prevDate（日本の前の営業日）より前の米国市場しかないとき（米国が休みだった日）は、すでに前の日に織り込まれているので null。
 */
export function usReturnFor(us: DailyBar[], date: string, prevDate: string): number | null {
  let i = us.length - 1;
  while (i >= 0 && us[i].date >= date) i--;
  if (i < 1 || us[i].date < prevDate || !(us[i - 1].c > 0)) return null;
  return (us[i].c / us[i - 1].c - 1) * 100;
}

/** 持ち越しの対象銘柄。overnightSymbols が空なら symbols と同じ */
export const overnightSymbols = (s: Settings) => (s.overnightSymbols.length > 0 ? s.overnightSymbols : s.symbols);

/** 日足の値で動かす戦略か */
export function isDailyStrategy(s: Settings): boolean {
  return s.strategy === "gapopen" || s.strategy === "overnight" || s.strategy === "gapopen_overnight";
}
export const runsGapOpen = (s: Settings) => s.strategy === "gapopen" || s.strategy === "gapopen_overnight";
export const runsOvernight = (s: Settings) => s.strategy === "overnight" || s.strategy === "gapopen_overnight";

const JST_OFFSET = 9 * 3600;
/** "YYYY-MM-DD" の JST の時刻（分）を UNIX秒にする */
export function jstTime(date: string, minutes: number): number {
  return Date.parse(`${date}T00:00:00Z`) / 1000 - JST_OFFSET + minutes * 60;
}

/** 日足の並びから、その日の OpenQuote を作る。前日がない、値が壊れている、ギャップが大きすぎる日は null */
export function openQuote(bars: DailyBar[], i: number, maxGapPct = 25): OpenQuote | null {
  const b = bars[i];
  const p = bars[i - 1];
  if (!b || !p || !(b.o > 0) || b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c)) return null;
  const prevClose = p.c - (b.dividend ?? 0);
  if (!(prevClose > 0) || Math.abs(b.o - prevClose) / prevClose > maxGapPct / 100) return null;
  const pp = bars[i - 2];
  const base = pp ? pp.c - (p.dividend ?? 0) : 0;
  return { prevClose, open: b.o, low: b.l, close: b.c, ...(b.dividend ? { dividend: b.dividend } : {}), ...(base > 0 ? { prevReturnPct: ((p.c - base) / base) * 100 } : {}) };
}

/** 安寄り買いの売りを分足で判定する設定か（時刻を決めて売る、または損切りを遅らせる） */
export const usesIntradayExit = (s: Settings) => s.gapExitAt !== "" || s.gapStopFrom !== "";

/**
 * 分足で見た安寄り買いの売り。bars はその日の確定した足（時刻順）。
 * - gapStopFrom 以降の足で、始値がすでに損切りの値以下ならその始値で、足の安値が届けば損切りの値で売る（どちらも滑りを引く）。
 * - gapExitAt 以降の最初の足の始値で売る（成行なので滑りを引く）。同じ足なら、始値で売るので損切りより先。
 * どちらにも当たらなければ null（持ち続ける）。
 */
export function gapIntradayExit(pos: Position, bars: Bar[], s: Settings, fine: boolean): { t: number; price: number; reason: ExitReason } | null {
  const stopFrom = s.gapStopFrom ? hhmmToMinutes(s.gapStopFrom) : 0;
  const exitAt = s.gapExitAt ? hhmmToMinutes(s.gapExitAt) : Infinity;
  const slip = (price: number) => s.slippageTicks * tickSize(price, fine);
  for (const b of bars) {
    if (b.t < pos.entryT) continue;
    const mins = jstMinutes(b.t);
    if (mins >= exitAt) return { t: b.t, price: b.o - slip(b.o), reason: b.o <= pos.stop ? "stop_loss" : "force_close" };
    if (mins < stopFrom) continue;
    if (b.o <= pos.stop) return { t: b.t, price: b.o - slip(b.o), reason: "stop_loss" };
    if (b.l <= pos.stop) return { t: b.t, price: pos.stop - slip(pos.stop), reason: "stop_loss" };
  }
  return null;
}

/** 安寄り買いで保有中のポジション（持ち越しのポジションは含まない） */
export function gapPositions(state: DayState): Position[] {
  return [...(state.position && !state.position.overnight ? [state.position] : []), ...(state.more ?? [])];
}

/** 安寄り買いのポジションを1つ決済する。1銘柄目を決済したら、2銘柄目以降を前に詰める */
export function closeGapPosition(state: DayState, s: Settings, pos: Position, t: number, price: number, reason: ExitReason): Trade {
  const rest = gapPositions(state).filter((p) => p !== pos);
  state.position = pos;
  const trade = closePosition(state, s, t, price, reason);
  state.position = rest.shift() ?? null;
  if (rest.length > 0) state.more = rest;
  else delete state.more;
  return trade;
}

/**
 * 1回分の処理。quotes には寄り付いた銘柄のその時点の値を渡す。state を書き換え、決済された取引を返す。
 * - まだ判断していない銘柄は、ここで入るかどうかを決める（あとから同じ銘柄に入り直すことはない）。
 *   条件に合う銘柄をギャップの大きい順に gapMaxPositions 銘柄まで買う（既定は1銘柄）。
 *   gapPrevDropPct があれば、前日もそれ以上下げていた銘柄だけを候補にする（前日の騰落が分からない銘柄は見送る）。
 * - 保有中の銘柄は、安値が損切りの値以下なら損切り、dayComplete なら終値で決済する。
 */
export function gapOpenTick(state: DayState, s: Settings, quotes: Record<string, OpenQuote>, now: number, dayComplete: boolean, intraday?: Record<string, Bar[]>): Trade[] {
  const trades: Trade[] = [];
  const decided = (state.decided ??= []);
  const fresh = Object.keys(quotes).filter((sym) => s.symbols.includes(sym) && !decided.includes(sym));
  decided.push(...fresh);

  const gap = (sym: string) => (quotes[sym].open - quotes[sym].prevClose) / quotes[sym].prevClose;
  const dropped = (sym: string) => s.gapPrevDropPct <= 0 || (quotes[sym].prevReturnPct ?? 0) <= -s.gapPrevDropPct;
  const candidates = fresh.filter((sym) => gap(sym) * 100 <= -s.gapMinPct && dropped(sym)).sort((a, b) => gap(a) - gap(b));
  const max = Math.max(1, s.gapMaxPositions);
  for (const symbol of candidates) {
    if (gapPositions(state).length >= max || state.halted || isCarried(state)) break;
    const fine = s.fineTickSymbols.includes(symbol);
    const entry = quotes[symbol].open;
    const shares = s.gapPositionYen > 0 ? Math.floor(s.gapPositionYen / (entry * 100)) * 100 : s.shares;
    if (shares <= 0 || (s.maxPositionYen > 0 && entry * shares > s.maxPositionYen)) continue;
    const tick = tickSize(entry, fine);
    const slip = s.slippageTicks * tick;
    // 損切り時の損失がその日の残りの損失枠に収まるよう、損切り幅を狭める。複数銘柄を持つときは枠を銘柄数で割る
    const budget = (s.dailyLossLimitYen + state.realizedPnl) / max - 2 * s.commissionPerOrderYen;
    const maxDist = cleanPrice(Math.floor((budget / shares - slip) / tick + 1e-6) * tick);
    if (maxDist < tick) continue;
    const stop = Math.max(roundToTick(entry * (1 - s.gapStopPct / 100), "down", fine), cleanPrice(entry - maxDist));
    // 利確は置かない。届かない値を入れておく
    const pos: Position = { symbol, side: "long", shares, entryT: jstTime(state.date, 9 * 60), entryPrice: entry, stop, target: cleanPrice(entry * 100) };
    if (!state.position) state.position = pos;
    else (state.more ??= []).push(pos);
  }

  for (const pos of gapPositions(state)) {
    const q = quotes[pos.symbol];
    const bars = usesIntradayExit(s) ? intraday?.[pos.symbol] : undefined;
    if (bars) {
      // 分足で、時刻を決めた売りと、遅らせた損切りを判定する
      const exit = gapIntradayExit(pos, bars, s, s.fineTickSymbols.includes(pos.symbol));
      if (exit) trades.push(closeGapPosition(state, s, pos, exit.t, exit.price, exit.reason));
      else if (dayComplete && q) trades.push(closeGapPosition(state, s, pos, jstTime(state.date, 15 * 60 + 30), q.close, "eod"));
      continue;
    }
    // 分足を使う設定なのに分足が取れていないときは、大引け後に日足で判定する（場中は何もしない）
    if (!q || (usesIntradayExit(s) && !dayComplete)) continue;
    if (q.low <= pos.stop) {
      const slip = s.slippageTicks * tickSize(pos.stop, s.fineTickSymbols.includes(pos.symbol));
      trades.push(closeGapPosition(state, s, pos, now, pos.stop - slip, "stop_loss"));
    } else if (dayComplete) {
      trades.push(closeGapPosition(state, s, pos, jstTime(state.date, 15 * 60 + 30), q.close, "eod"));
    }
  }
  return trades;
}

/** 前の営業日から持ち越したポジションか（建てたのが今日の寄り付きより前） */
export function isCarried(state: DayState): boolean {
  return state.position?.overnight === true && state.position.entryT < jstTime(state.date, 9 * 60);
}

/**
 * 持ち越したポジションを、寄り付いていれば寄り値で売る。権利落ち日は配当を受け取るので、
 * その分を決済値に足して損益に含める。
 */
export function overnightExit(state: DayState, s: Settings, quotes: Record<string, OpenQuote>): Trade[] {
  const pos = state.position;
  if (!pos || !isCarried(state)) return [];
  const q = quotes[pos.symbol];
  if (!q) return [];
  return [closePosition(state, s, jstTime(state.date, 9 * 60), q.open + (q.dividend ?? 0), "next_open")];
}

/**
 * 大引けでの持ち越しの買い。場中（始値から終値）に overnightMinPct 以上上げた銘柄のうち、最も上げた
 * 1銘柄を終値で買う。損切りは置けない。実際には大引けの前に注文を出すので、判断はその時点の値になる。
 * overnightWeekdays があればその曜日の大引けだけで買い、overnightSymbols があればその銘柄だけを対象にする。
 * overnightSkipUsHolidays なら、その夜に米国市場が開かない日は買わない。
 */
export function overnightEntry(state: DayState, s: Settings, quotes: Record<string, OpenQuote>): void {
  if (state.position || state.halted) return;
  if (s.overnightWeekdays.length > 0 && !s.overnightWeekdays.includes(new Date(`${state.date}T00:00:00Z`).getUTCDay())) return;
  // 日本の大引けのあとに開く米国市場は、同じ日付の取引日
  if (s.overnightSkipUsHolidays && usMarketClosed(state.date)) return;
  const targets = overnightSymbols(s);
  const shares = s.overnightShares > 0 ? s.overnightShares : s.shares;
  const cap = s.overnightMaxPositionYen > 0 ? s.overnightMaxPositionYen : s.maxPositionYen;
  const gain = (sym: string) => (quotes[sym].close - quotes[sym].open) / quotes[sym].open;
  const pick = Object.keys(quotes)
    .filter((sym) => targets.includes(sym) && gain(sym) * 100 >= s.overnightMinPct && !(cap > 0 && quotes[sym].close * shares > cap))
    .sort((a, b) => gain(b) - gain(a))[0];
  if (!pick) return;
  const entry = quotes[pick].close;
  state.position = { symbol: pick, side: "long", shares, entryT: jstTime(state.date, 15 * 60 + 30), entryPrice: entry, stop: 0, target: cleanPrice(entry * 100), overnight: true };
}

/**
 * 米国の翌日の逆張り。usReturnPct は、今日の寄り付き前に終わった直近の米国市場（S&P500）の前日比（%）。
 * - 対象銘柄が寄り付いていて、まだ判断していなければ、usReturnPct が usFadeMinPct 以上なら寄り値で買う（寄成）。
 *   usReturnPct が分からない（undefined）あいだは判断を待ち、大引け後まで分からなければ見送る。
 * - 保有中なら、大引け後に終値で売る（引成）。損切りは置かない。
 * 安寄り買いや持ち越しとは別枠（state.usFade）で持つ。
 */
export function usFadeTick(state: DayState, s: Settings, quotes: Record<string, OpenQuote>, usReturnPct: number | null | undefined, dayComplete: boolean): Trade[] {
  if (!s.usFadeSymbol) return [];
  const q = quotes[s.usFadeSymbol];
  if (!state.usFadeDecided && q && (usReturnPct !== undefined || dayComplete)) {
    state.usFadeDecided = true;
    if (usReturnPct != null && usReturnPct >= s.usFadeMinPct && !state.halted) {
      state.usFade = { symbol: s.usFadeSymbol, side: "long", shares: s.usFadeShares, entryT: jstTime(state.date, 9 * 60), entryPrice: q.open, stop: 0, target: cleanPrice(q.open * 100) };
    }
  }
  if (state.usFade && q && dayComplete) {
    // closePosition は state.position を決済するので、一時的に入れ替える
    const keep = state.position;
    state.position = state.usFade;
    const trade = closePosition(state, s, jstTime(state.date, 15 * 60 + 30), q.close, "eod");
    state.position = keep;
    delete state.usFade;
    return [trade];
  }
  return [];
}

/**
 * 日足で動かす戦略の1日分。持ち越しの決済 → 安寄り買い → 持ち越しの買い、の順に処理する。
 * 安寄り買いは 9:00〜15:30、持ち越しは 15:30〜翌 9:00 に持つので、両方を使っても同時に持つのは1ポジションまで。
 * dayComplete は大引け後で終値が確定していること。state を書き換え、決済された取引を返す。
 */
export function dailyTick(state: DayState, s: Settings, quotes: Record<string, OpenQuote>, now: number, dayComplete: boolean, intraday?: Record<string, Bar[]>, usReturnPct?: number | null): Trade[] {
  const trades = overnightExit(state, s, quotes);
  trades.push(...usFadeTick(state, s, quotes, usReturnPct, dayComplete));
  // 持ち越しがまだ寄り付いていない間は、安寄り買いの判断を待つ
  if (isCarried(state)) return trades;
  if (runsGapOpen(s)) trades.push(...gapOpenTick(state, s, quotes, now, dayComplete, intraday));
  if (runsOvernight(s) && dayComplete && !state.overnightDecided && Object.keys(quotes).length > 0) {
    overnightEntry(state, s, quotes);
    state.overnightDecided = true;
  }
  return trades;
}

/**
 * 日足でのバックテスト（安寄り買い、持ち越し、その両方）。銘柄ごとの日足を日付でそろえ、1日ずつ dailyTick に流す。
 * 持ち越したポジションは、その銘柄の次の足が出た日の寄り付きで決済する。
 * 損切りした時刻は日足からは分からないので、取引の決済時刻は大引けにしてある。
 * usReturns（日付 → その朝までに分かる S&P500 の前日比%）を渡すと、米国の翌日の逆張りも動かす。
 * gapExitAt（時刻を決めて売る）と gapStopFrom（損切りを遅らせる）は分足が要るので、ここでは使わない。
 * 持ち越した銘柄の翌営業日の足が壊れているときは、その取引を数えない。
 * 渡した銘柄はすべて対象にする。ただし overnightSymbols にだけある銘柄は、持ち越しだけの対象にする。
 */
export function runGapOpenBacktest(data: [string, DailyBar[]][], settings: Settings, usReturns?: Map<string, number | null>): BacktestResult {
  const onlyOvernight = (sym: string) => (settings.overnightSymbols.includes(sym) || sym === settings.usFadeSymbol) && !settings.symbols.includes(sym);
  const s: Settings = { ...settings, symbols: data.map(([sym]) => sym).filter((sym) => !onlyOvernight(sym)) };
  const index = data.map(([sym, bars]) => [sym, bars, new Map(bars.map((b, i) => [b.date, i]))] as const);
  const dates = [...new Set(data.flatMap(([, bars]) => bars.slice(1).map((b) => b.date)))].sort();
  const daily: DayResult[] = [];
  const trades: Trade[] = [];
  let carried: DayState["position"] = null;
  for (const date of dates) {
    const quotes: Record<string, OpenQuote> = {};
    for (const [sym, bars, at] of index) {
      const i = at.get(date);
      const q = i == null ? null : openQuote(bars, i);
      if (q) quotes[sym] = q;
    }
    // 持ち越した銘柄のこの日の足が壊れている（桁違いの値など）ときは、買値も売値も信用できないので取引ごと無かったことにする
    const held = (carried as DayState["position"])?.symbol;
    if (held && !quotes[held] && index.some(([sym, , at]) => sym === held && at.has(date))) carried = null;
    const state = newDay(date);
    state.position = carried;
    trades.push(...dailyTick(state, s, quotes, jstTime(date, 15 * 60 + 30), true, undefined, usReturns ? (usReturns.get(date) ?? null) : undefined));
    carried = state.position;
    daily.push({ date, pnl: state.realizedPnl, trades: state.tradeCount, halted: state.halted });
  }
  return {
    symbol: data.length === 1 ? data[0][0] : `${data.length}銘柄`,
    summary: summarizeDays(daily, trades),
    fineTick: data.every(([sym]) => s.fineTickSymbols.includes(sym)),
    tickMismatch: false,
    missingOpenDays: 0,
    monthly: monthly(daily),
    daily,
    trades,
  };
}
