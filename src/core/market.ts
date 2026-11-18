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

/** 東証の通常の呼値（TOPIX500採用銘柄の細かい呼値は考慮しない＝保守的） */
export function tickSize(price: number): number {
  if (price <= 3000) return 1;
  if (price <= 5000) return 5;
  if (price <= 30000) return 10;
  if (price <= 50000) return 50;
  if (price <= 300000) return 100;
  if (price <= 500000) return 500;
  return 1000;
}

export function roundToTick(price: number, mode: "down" | "up" | "nearest" = "nearest"): number {
  const tick = tickSize(price);
  const q = price / tick;
  const n = mode === "down" ? Math.floor(q + 1e-9) : mode === "up" ? Math.ceil(q - 1e-9) : Math.round(q);
  return n * tick;
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
