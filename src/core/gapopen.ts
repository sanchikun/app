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
import { cleanPrice, roundToTick, tickSize } from "./market";
import type { DayState, Settings, Trade } from "./types";

/** その日ここまでの日足の値。prevClose は配当落ちを調整した前日終値 */
export interface OpenQuote {
  prevClose: number;
  open: number;
  low: number;
  close: number;
}

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
  return { prevClose, open: b.o, low: b.l, close: b.c };
}

/**
 * 1回分の処理。quotes には寄り付いた銘柄のその時点の値を渡す。state を書き換え、決済された取引を返す。
 * - まだ判断していない銘柄は、ここで入るかどうかを決める（あとから同じ銘柄に入り直すことはない）。
 *   同時に持つのは1ポジションまでなので、条件に合う銘柄が複数あればギャップが最も大きいものを買う。
 * - 保有中の銘柄は、安値が損切りの値以下なら損切り、dayComplete なら終値で決済する。
 */
export function gapOpenTick(state: DayState, s: Settings, quotes: Record<string, OpenQuote>, now: number, dayComplete: boolean): Trade[] {
  const trades: Trade[] = [];
  const decided = (state.decided ??= []);
  const fresh = Object.keys(quotes).filter((sym) => !decided.includes(sym));
  decided.push(...fresh);

  const gap = (sym: string) => (quotes[sym].open - quotes[sym].prevClose) / quotes[sym].prevClose;
  const candidates = fresh.filter((sym) => gap(sym) * 100 <= -s.gapMinPct).sort((a, b) => gap(a) - gap(b));
  for (const symbol of candidates) {
    if (state.position || state.halted) break;
    const fine = s.fineTickSymbols.includes(symbol);
    const entry = quotes[symbol].open;
    if (s.maxPositionYen > 0 && entry * s.shares > s.maxPositionYen) continue;
    const tick = tickSize(entry, fine);
    const slip = s.slippageTicks * tick;
    // 損切り時の損失がその日の残りの損失枠に収まるよう、損切り幅を狭める
    const budget = s.dailyLossLimitYen + state.realizedPnl - 2 * s.commissionPerOrderYen;
    const maxDist = cleanPrice(Math.floor((budget / s.shares - slip) / tick + 1e-6) * tick);
    if (maxDist < tick) continue;
    const stop = Math.max(roundToTick(entry * (1 - s.gapStopPct / 100), "down", fine), cleanPrice(entry - maxDist));
    // 利確は置かない。届かない値を入れておく
    state.position = { symbol, side: "long", shares: s.shares, entryT: jstTime(state.date, 9 * 60), entryPrice: entry, stop, target: cleanPrice(entry * 100) };
  }

  const pos = state.position;
  const q = pos ? quotes[pos.symbol] : undefined;
  if (pos && q) {
    if (q.low <= pos.stop) {
      const slip = s.slippageTicks * tickSize(pos.stop, s.fineTickSymbols.includes(pos.symbol));
      trades.push(closePosition(state, s, now, pos.stop - slip, "stop_loss"));
    } else if (dayComplete) {
      trades.push(closePosition(state, s, jstTime(state.date, 15 * 60 + 30), q.close, "eod"));
    }
  }
  return trades;
}

/**
 * 日足でのバックテスト。銘柄ごとの日足を日付でそろえ、1日ずつ gapOpenTick に流す。
 * 損切りした時刻は日足からは分からないので、取引の決済時刻は大引けにしてある。
 */
export function runGapOpenBacktest(data: [string, DailyBar[]][], settings: Settings): BacktestResult {
  const s: Settings = { ...settings, symbols: data.map(([sym]) => sym) };
  const index = data.map(([sym, bars]) => [sym, bars, new Map(bars.map((b, i) => [b.date, i]))] as const);
  const dates = [...new Set(data.flatMap(([, bars]) => bars.slice(1).map((b) => b.date)))].sort();
  const daily: DayResult[] = [];
  const trades: Trade[] = [];
  for (const date of dates) {
    const quotes: Record<string, OpenQuote> = {};
    for (const [sym, bars, at] of index) {
      const i = at.get(date);
      const q = i == null ? null : openQuote(bars, i);
      if (q) quotes[sym] = q;
    }
    const state = newDay(date);
    trades.push(...gapOpenTick(state, s, quotes, jstTime(date, 15 * 60 + 30), true));
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
