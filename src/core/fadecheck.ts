/**
 * 「前日安値に指値で買い、大引けで売る」を分足で確かめる。
 * 日足の検証では約定した時刻もその後の値動きも分からないので、5分足で
 * いつ約定したか、その日の何番目か、約定後にどこまで下げたかを調べる。
 */
import type { Bar } from "./types";

export type FillKind = "open" | "intraday" | "missing-bar";

export interface FadeFill {
  kind: FillKind;
  /** 約定した足の開始時刻（UNIX秒）。寄り付きで約定した日はその日の最初の足、欠けた足で約定した日は null */
  t: number | null;
  entry: number;
  /** 約定後の最安値（約定した足を含む） */
  lowAfter: number;
}

export interface FadeDayInput {
  /** 買い指値（配当落ちを調整した前日安値） */
  limit: number;
  tick: number;
  /** 日足の始値・安値。板寄せの値と、分足に欠けている時間帯の値を補う */
  open: number;
  low: number;
  /** その日の5分足（時刻順） */
  bars: Bar[];
}

/**
 * 約定の判定。始値が指値より安ければ寄り付きで約定、場中は指値を1ティック以上抜けた足で約定とする。
 * 分足では抜けていないのに日足の安値が抜けている日は、分足に欠けている時間帯（9:00〜9:05、
 * 15:25〜15:30）で約定したとみなす。
 */
export function fadeFill(d: FadeDayInput): FadeFill | null {
  const through = d.limit - d.tick + 1e-6;
  const lowFrom = (i: number) => Math.min(d.low, ...d.bars.slice(i).map((b) => b.l));
  if (d.open < d.limit - 1e-6) return { kind: "open", t: d.bars[0]?.t ?? null, entry: d.open, lowAfter: Math.min(d.low, d.open) };
  const i = d.bars.findIndex((b) => b.l <= through);
  if (i >= 0) return { kind: "intraday", t: d.bars[i].t, entry: d.limit, lowAfter: Math.min(...d.bars.slice(i).map((b) => b.l)) };
  if (d.low <= through) return { kind: "missing-bar", t: null, entry: d.limit, lowAfter: lowFrom(d.bars.length) };
  return null;
}

/**
 * 損益率。stopPct を渡すと、約定後に entry×(1−stopPct/100) まで下げた日は、そこから1ティック滑って損切りしたとする。
 */
export function fadeReturn(fill: FadeFill, close: number, tick: number, stopPct?: number): number {
  if (stopPct != null) {
    const stop = fill.entry * (1 - stopPct / 100);
    if (fill.lowAfter <= stop) return (stop - tick - fill.entry) / fill.entry;
  }
  return (close - fill.entry) / fill.entry;
}
