/**
 * 日足で検証できる「当日中に手仕舞う」ルールの集まり。
 * どのルールも、前日までの日足と当日の始値だけで入るかどうかを決め、当日の終値で決済する。
 * 寄り付きと大引けは成行（寄成・引成）で板寄せの値段そのもので約定するので滑りを加えない。
 * 逆指値で入るルールだけ、滑りを1ティック加える。指値で入るルールは、値が指値を1ティック以上
 * 抜けた日だけ約定とする（同値に触れただけの日は、約定していれば必ず勝ちになるので数えない）。
 */
import type { DailyBar } from "./gapstudy";
import { tickSize } from "./market";

export interface DailyTrade {
  symbol: string;
  date: string;
  /** 損益率（売りは符号を反転済み） */
  ret: number;
}

export interface RuleContext {
  bars: DailyBar[];
  /** 当日の位置。bars[i] の始値までは見てよい。高値・安値・終値は見てはいけない */
  i: number;
  /** 配当落ちを調整した前日終値 */
  prevClose: number;
  /** 当日のギャップ（%） */
  gapPct: number;
  /** 同じ日の全銘柄のギャップの平均（%）。相場全体の寄り付きの強弱 */
  marketGapPct: number;
}

export interface DailyRule {
  key: string;
  label: string;
  side: "long" | "short";
  /**
   * 入るなら "open"（寄り付きで成行）か、逆指値（stop）または指値（limit）の値段を返す。
   * "overnight" は前日の大引けで入り、当日の寄り付きで手仕舞う（持ち越し）。このときは前日の終値までの
   * 情報だけで判断すること。当日のギャップ（gapPct、marketGapPct）は結果そのものなので見てはいけない。
   */
  entry(ctx: RuleContext): "open" | "overnight" | { stop: number } | { limit: number } | null;
}

/** 前日の終値が前々日より何%動いたか（配当落ち調整済み） */
function prevReturnPct(bars: DailyBar[], i: number): number | null {
  if (i < 2) return null;
  const base = bars[i - 2].c - (bars[i - 1].dividend ?? 0);
  return base > 0 ? ((bars[i - 1].c - base) / base) * 100 : null;
}

/** 直近 n 日が続けて上げた（dir=1）か下げた（dir=-1）か */
function streak(bars: DailyBar[], i: number, n: number, dir: 1 | -1): boolean {
  if (i < n + 1) return false;
  for (let k = 1; k <= n; k++) {
    const base = bars[i - k - 1].c - (bars[i - k].dividend ?? 0);
    if ((bars[i - k].c - base) * dir <= 0) return false;
  }
  return true;
}

/** 前日の場中（始値から終値）の騰落率（%） */
function prevIntradayPct(bars: DailyBar[], i: number): number {
  const p = bars[i - 1];
  return p.o > 0 ? ((p.c - p.o) / p.o) * 100 : 0;
}

/** 前日の終値が、前日の値幅のどの位置か（0 = 安値、1 = 高値） */
function closeLocation(bars: DailyBar[], i: number): number | null {
  const p = bars[i - 1];
  return p.h > p.l ? (p.c - p.l) / (p.h - p.l) : null;
}

/** 前日の値幅が直近7日で最も狭いか */
function nr7(bars: DailyBar[], i: number): boolean {
  if (i < 7) return false;
  const r = (k: number) => bars[i - k].h - bars[i - k].l;
  for (let k = 2; k <= 7; k++) if (r(k) <= r(1)) return false;
  return true;
}

// 権利落ち日は配当の分だけ前日の高値・安値も下げて比べる
const prevHigh = (c: RuleContext) => c.bars[c.i - 1].h - (c.bars[c.i].dividend ?? 0);
const prevLow = (c: RuleContext) => c.bars[c.i - 1].l - (c.bars[c.i].dividend ?? 0);

export const DAILY_RULES: DailyRule[] = [
  { key: "all-long", label: "毎日（比較用）", side: "long", entry: () => "open" },
  { key: "all-short", label: "毎日（比較用）", side: "short", entry: () => "open" },
  { key: "gap-down", label: "1%以上安く寄った", side: "long", entry: (c) => (c.gapPct <= -1 ? "open" : null) },
  { key: "gap-up", label: "1%以上高く寄った", side: "short", entry: (c) => (c.gapPct >= 1 ? "open" : null) },
  { key: "gap-down-after-drop", label: "前日2%以上下げ、さらに1%以上安く寄った", side: "long", entry: (c) => (c.gapPct <= -1 && (prevReturnPct(c.bars, c.i) ?? 0) <= -2 ? "open" : null) },
  { key: "gap-down-calm", label: "相場全体は安くないのに1%以上安く寄った", side: "long", entry: (c) => (c.gapPct <= -1 && c.marketGapPct > -0.3 ? "open" : null) },
  { key: "idio-gap-down", label: "相場より1%以上安く寄った", side: "long", entry: (c) => (c.gapPct - c.marketGapPct <= -1 ? "open" : null) },
  { key: "idio-gap-up", label: "相場より1%以上高く寄った", side: "short", entry: (c) => (c.gapPct - c.marketGapPct >= 1 ? "open" : null) },
  { key: "mkt-gap-down", label: "相場全体が1%以上安く寄った", side: "long", entry: (c) => (c.marketGapPct <= -1 ? "open" : null) },
  { key: "mkt-gap-up", label: "相場全体が1%以上高く寄った", side: "short", entry: (c) => (c.marketGapPct >= 1 ? "open" : null) },
  { key: "prev-drop", label: "前日3%以上下げた", side: "long", entry: (c) => ((prevReturnPct(c.bars, c.i) ?? 0) <= -3 ? "open" : null) },
  { key: "prev-jump", label: "前日3%以上上げた", side: "short", entry: (c) => ((prevReturnPct(c.bars, c.i) ?? 0) >= 3 ? "open" : null) },
  { key: "down3", label: "3日続落", side: "long", entry: (c) => (streak(c.bars, c.i, 3, -1) ? "open" : null) },
  { key: "up3", label: "3日続伸", side: "short", entry: (c) => (streak(c.bars, c.i, 3, 1) ? "open" : null) },
  { key: "weak-close", label: "前日安値引け（下位10%）", side: "long", entry: (c) => ((closeLocation(c.bars, c.i) ?? 0.5) <= 0.1 ? "open" : null) },
  { key: "strong-close", label: "前日高値引け（上位10%）", side: "long", entry: (c) => ((closeLocation(c.bars, c.i) ?? 0.5) >= 0.9 ? "open" : null) },
  { key: "break-high", label: "前日高値を上抜け", side: "long", entry: (c) => ({ stop: prevHigh(c) }) },
  { key: "break-low", label: "前日安値を下抜け", side: "short", entry: (c) => ({ stop: prevLow(c) }) },
  { key: "nr7-break-high", label: "値幅縮小の翌日に前日高値を上抜け", side: "long", entry: (c) => (nr7(c.bars, c.i) ? { stop: prevHigh(c) } : null) },
  { key: "fade-low", label: "前日安値に指値で買い", side: "long", entry: (c) => ({ limit: prevLow(c) }) },
  { key: "fade-high", label: "前日高値に指値で売り", side: "short", entry: (c) => ({ limit: prevHigh(c) }) },
  // ここから持ち越し（大引けで買い、翌朝の寄り付きで売る）。「当日」は買う日のこと
  { key: "on-all", label: "持ち越し：毎日", side: "long", entry: () => "overnight" },
  ...["月", "火", "水", "木", "金"].map((name, k): DailyRule => ({ key: `on-dow${k + 1}`, label: `持ち越し：${name}曜の引けで買う`, side: "long", entry: (c) => (new Date(`${c.bars[c.i - 1].date}T00:00:00Z`).getUTCDay() === k + 1 ? "overnight" : null) })),
  { key: "on-drop", label: "持ち越し：当日3%以上下げた", side: "long", entry: (c) => ((prevReturnPct(c.bars, c.i) ?? 0) <= -3 ? "overnight" : null) },
  { key: "on-jump", label: "持ち越し：当日3%以上上げた", side: "long", entry: (c) => ((prevReturnPct(c.bars, c.i) ?? 0) >= 3 ? "overnight" : null) },
  { key: "on-intraday-down", label: "持ち越し：場中に2%以上下げた", side: "long", entry: (c) => (prevIntradayPct(c.bars, c.i) <= -2 ? "overnight" : null) },
  { key: "on-intraday-up", label: "持ち越し：場中に2%以上上げた", side: "long", entry: (c) => (prevIntradayPct(c.bars, c.i) >= 2 ? "overnight" : null) },
  { key: "on-weak-close", label: "持ち越し：安値引け（下位10%）", side: "long", entry: (c) => ((closeLocation(c.bars, c.i) ?? 0.5) <= 0.1 ? "overnight" : null) },
  { key: "on-strong-close", label: "持ち越し：高値引け（上位10%）", side: "long", entry: (c) => ((closeLocation(c.bars, c.i) ?? 0.5) >= 0.9 ? "overnight" : null) },
  { key: "on-down3", label: "持ち越し：3日続落", side: "long", entry: (c) => (streak(c.bars, c.i, 3, -1) ? "overnight" : null) },
];

function usable(b: DailyBar): boolean {
  return b.o > 0 && b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c);
}

/** 配当落ちを調整した当日のギャップ（%）。データが壊れている日は null */
export function gapPctAt(bars: DailyBar[], i: number, maxGapPct = 25): number | null {
  if (i < 1 || !usable(bars[i]) || !usable(bars[i - 1])) return null;
  const prevClose = bars[i - 1].c - (bars[i].dividend ?? 0);
  if (!(prevClose > 0)) return null;
  const gap = ((bars[i].o - prevClose) / prevClose) * 100;
  return Math.abs(gap) > maxGapPct ? null : gap;
}

/** 日付ごとの全銘柄のギャップの平均（%） */
export function marketGaps(data: [string, DailyBar[]][]): Map<string, number> {
  const sums = new Map<string, [number, number]>();
  for (const [, bars] of data) {
    for (let i = 1; i < bars.length; i++) {
      const g = gapPctAt(bars, i);
      if (g == null) continue;
      const s = sums.get(bars[i].date) ?? [0, 0];
      sums.set(bars[i].date, [s[0] + g, s[1] + 1]);
    }
  }
  return new Map([...sums].map(([d, [sum, n]]) => [d, sum / n]));
}

/**
 * 1銘柄にルールを当てはめる。逆指値で入るときだけ stopSlippageTicks を加える。
 * stopLossPct を渡すと、約定値からその%だけ不利に動いた日は、そこから1ティック滑って損切りしたとする。
 * 寄り付きや指値で入るルールは、約定がその日の安値（売りなら高値）より必ず前なので、日足でも順番を
 * 間違えずに判定できる。逆指値で入るルールは約定の前後が分からないので損切りを付けない。
 */
export function runRule(rule: DailyRule, symbol: string, bars: DailyBar[], market: Map<string, number>, stopSlippageTicks = 1, stopLossPct?: number): DailyTrade[] {
  const trades: DailyTrade[] = [];
  const dir = rule.side === "long" ? 1 : -1;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const gapPct = gapPctAt(bars, i);
    const marketGapPct = market.get(b.date);
    if (gapPct == null || marketGapPct == null) continue;
    const e = rule.entry({ bars, i, prevClose: bars[i - 1].c - (b.dividend ?? 0), gapPct, marketGapPct });
    if (e == null) continue;
    if (e === "overnight") {
      // 前日の大引けで買い、当日の寄り付きで売る。配当落ち日は配当を受け取るので、調整済みのギャップがそのまま損益率になる
      trades.push({ symbol, date: b.date, ret: (dir * gapPct) / 100 });
      continue;
    }
    let entry = b.o;
    if (e !== "open" && "stop" in e) {
      // 寄り付きですでに抜けていれば始値で、場中に抜ければ逆指値の1ティック先で約定
      const tick = tickSize(e.stop, true);
      const trigger = e.stop + dir * tick;
      if (dir === 1 ? b.o >= trigger : b.o <= trigger) entry = b.o;
      else if (dir === 1 ? b.h >= trigger : b.l <= trigger) entry = trigger + dir * stopSlippageTicks * tick;
      else continue;
    } else if (e !== "open") {
      // 寄り付きが指値より有利なら始値で、場中に指値を1ティック以上抜けたら指値で約定
      const tick = tickSize(e.limit, true);
      if (dir === 1 ? b.o < e.limit : b.o > e.limit) entry = b.o;
      else if (dir === 1 ? b.l <= e.limit - tick : b.h >= e.limit + tick) entry = e.limit;
      else continue;
    }
    let exit = b.c;
    if (stopLossPct != null && (e === "open" || "limit" in e)) {
      const stop = entry * (1 - (dir * stopLossPct) / 100);
      if (dir === 1 ? b.l <= stop : b.h >= stop) exit = stop - dir * tickSize(stop, true);
    }
    trades.push({ symbol, date: b.date, ret: (dir * (exit - entry)) / entry });
  }
  return trades;
}
