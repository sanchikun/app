import { SESSION_OPEN, jstMinutes, roundToTick, tickSize } from "./market";
import type { Bar, Settings, Signal } from "./types";

/**
 * その日のここまでの足（最後が確定したばかりの足）からシグナルを返す。
 * 約定は次の足の始値なので、ここでは未来の値を見ない。
 */
export type Strategy = (bars: Bar[], settings: Settings) => Signal | null;

/** 寄り付きレンジのブレイクアウト。終値がレンジを抜けた足でだけ発火する。 */
export const orb: Strategy = (bars, s) => {
  if (bars.length < 2) return null;
  const rangeEnd = SESSION_OPEN + s.orbMinutes;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (jstMinutes(last.t) < rangeEnd) return null;
  const range = bars.filter((b) => jstMinutes(b.t) < rangeEnd);
  if (range.length === 0) return null;
  const hi = Math.max(...range.map((b) => b.h));
  const lo = Math.min(...range.map((b) => b.l));
  const risk = Math.max((hi - lo) / 2, 2 * tickSize(last.c));

  if (prev.c <= hi && last.c > hi) {
    return {
      side: "long",
      stop: roundToTick(last.c - risk, "down"),
      target: roundToTick(last.c + risk * s.orbRewardRisk, "up"),
    };
  }
  if (s.allowShort && prev.c >= lo && last.c < lo) {
    return {
      side: "short",
      stop: roundToTick(last.c + risk, "up"),
      target: roundToTick(last.c - risk * s.orbRewardRisk, "down"),
    };
  }
  return null;
};

/** VWAPからの乖離が k×標準偏差 を超えた足で逆張りし、VWAPへの回帰を狙う。 */
export const vwap: Strategy = (bars, s) => {
  if (bars.length < Math.max(s.vwapMinBars, 2)) return null;
  let pv = 0;
  let vol = 0;
  const devs: number[] = [];
  let current = 0;
  for (const b of bars) {
    // 出来高0の足でも計算が止まらないよう最低1として扱う
    const v = Math.max(b.v, 1);
    pv += ((b.h + b.l + b.c) / 3) * v;
    vol += v;
    current = pv / vol;
    devs.push(b.c - current);
  }
  const mean = devs.reduce((a, d) => a + d, 0) / devs.length;
  const sd = Math.sqrt(devs.reduce((a, d) => a + (d - mean) ** 2, 0) / devs.length);
  if (sd === 0) return null;
  const last = bars[bars.length - 1];
  const dev = devs[devs.length - 1];
  const prevDev = devs[devs.length - 2];
  const band = s.vwapK * sd;
  const minMove = 2 * tickSize(last.c);

  if (dev < -band && prevDev >= -band && current - last.c >= minMove) {
    return {
      side: "long",
      stop: roundToTick(last.c - (current - last.c), "down"),
      target: roundToTick(current, "down"),
    };
  }
  if (s.allowShort && dev > band && prevDev <= band && last.c - current >= minMove) {
    return {
      side: "short",
      stop: roundToTick(last.c + (last.c - current), "up"),
      target: roundToTick(current, "up"),
    };
  }
  return null;
};

export const STRATEGIES: Record<Settings["strategy"], Strategy> = { orb, vwap };
