import type { Bar } from "./types";

const JST_OFFSET = 9 * 3600;

/** UNIX秒 → JSTの日付 "YYYY-MM-DD" */
export function jstDate(t: number): string {
  return new Date((t + JST_OFFSET) * 1000).toISOString().slice(0, 10);
}

/** UNIX秒 → JSTの0時からの経過分 */
export function jstMinutes(t: number): number {
  return Math.floor(((t + JST_OFFSET) % 86400) / 60);
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export const SESSION_OPEN = 9 * 60;
export const SESSION_CLOSE = 15 * 60 + 30;

/** 東証の立会時間（前場 9:00-11:30、後場 12:30-15:30）に始まる足か */
export function inSession(t: number): boolean {
  const m = jstMinutes(t);
  return (m >= SESSION_OPEN && m < 11 * 60 + 30) || (m >= 12 * 60 + 30 && m < SESSION_CLOSE);
}

/** 東証の通常の呼値。[この価格以下, 刻み] */
const STANDARD_TICKS: [number, number][] = [
  [3000, 1], [5000, 5], [30000, 10], [50000, 50], [300000, 100], [500000, 500], [3000000, 1000], [5000000, 5000],
];
/** TOPIX500 構成銘柄の細かい呼値 */
const FINE_TICKS: [number, number][] = [
  [1000, 0.1], [3000, 0.5], [10000, 1], [30000, 5], [100000, 10], [300000, 50], [1000000, 100], [3000000, 500], [5000000, 1000],
];

/** 呼値の刻み。fine は TOPIX500 構成銘柄の細かい呼値を使うかどうか */
export function tickSize(price: number, fine = false): number {
  const table = fine ? FINE_TICKS : STANDARD_TICKS;
  for (const [limit, tick] of table) if (price <= limit) return tick;
  return table[table.length - 1][1] * (fine ? 10 : 2);
}

/** 0.1円刻みの計算で出る浮動小数の誤差を落とす */
export function cleanPrice(price: number): number {
  return Math.round(price * 10) / 10;
}

export function roundToTick(price: number, mode: "down" | "up" | "nearest" = "nearest", fine = false): number {
  const tick = tickSize(price, fine);
  const q = price / tick;
  const n = mode === "down" ? Math.floor(q + 1e-6) : mode === "up" ? Math.ceil(q - 1e-6) : Math.round(q);
  return cleanPrice(n * tick);
}

/** 足の値が呼値の刻みに乗っていない割合。刻みの設定が銘柄と合っているかの確認用 */
export function tickMismatchRate(bars: Bar[], fine: boolean): number {
  if (bars.length === 0) return 0;
  const off = bars.filter((b) => {
    const q = b.c / tickSize(b.c, fine);
    return Math.abs(q - Math.round(q)) > 1e-6;
  }).length;
  return off / bars.length;
}

/** 立会時間内の足だけを日付ごとにまとめる（時刻順） */
export function groupByDate(bars: Bar[]): Map<string, Bar[]> {
  const days = new Map<string, Bar[]>();
  for (const bar of [...bars].sort((a, b) => a.t - b.t)) {
    if (!inSession(bar.t)) continue;
    const date = jstDate(bar.t);
    const list = days.get(date);
    if (list) list.push(bar);
    else days.set(date, [bar]);
  }
  return days;
}
