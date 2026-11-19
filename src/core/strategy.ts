import { SESSION_OPEN, jstMinutes, roundToTick, tickSize } from "./market";
import type { Bar, Settings, Signal } from "./types";

/**
 * その日のここまでの足（最後が確定したばかりの足）からシグナルを返す。
 * 約定は次の足の始値なので、ここでは未来の値を見ない。fine は細かい呼値の銘柄かどうか。
 */
export type Strategy = (bars: Bar[], settings: Settings, fine?: boolean, ctx?: { prevClose?: number }) => Signal | null;

/** 寄り付きレンジのブレイクアウト。終値がレンジを抜けた足でだけ発火する。 */
export const orb: Strategy = (bars, s, fine = false) => {
  if (bars.length < 2) return null;
  const rangeEnd = SESSION_OPEN + s.orbMinutes;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (jstMinutes(last.t) < rangeEnd) return null;
  const range = bars.filter((b) => jstMinutes(b.t) < rangeEnd);
  if (range.length === 0) return null;
  const hi = Math.max(...range.map((b) => b.h));
  const lo = Math.min(...range.map((b) => b.l));
  const risk = Math.max((hi - lo) / 2, 2 * tickSize(last.c, fine));

  if (prev.c <= hi && last.c > hi) {
    return {
      side: "long",
      stop: roundToTick(last.c - risk, "down", fine),
      target: roundToTick(last.c + risk * s.orbRewardRisk, "up", fine),
    };
  }
  if (s.allowShort && prev.c >= lo && last.c < lo) {
    return {
      side: "short",
      stop: roundToTick(last.c + risk, "up", fine),
      target: roundToTick(last.c - risk * s.orbRewardRisk, "down", fine),
    };
  }
  return null;
};

/** VWAPからの乖離が k×標準偏差 を超えた足で逆張りし、VWAPへの回帰を狙う。 */
export const vwap: Strategy = (bars, s, fine = false) => {
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
  const minMove = 2 * tickSize(last.c, fine);

  if (dev < -band && prevDev >= -band && current - last.c >= minMove) {
    return {
      side: "long",
      stop: roundToTick(last.c - (current - last.c), "down", fine),
      target: roundToTick(current, "down", fine),
    };
  }
  if (s.allowShort && dev > band && prevDev <= band && last.c - current >= minMove) {
    return {
      side: "short",
      stop: roundToTick(last.c + (last.c - current), "up", fine),
      target: roundToTick(current, "up", fine),
    };
  }
  return null;
};

/** 利確を置かずに大引け前の強制決済まで持つ戦略で使う、届かない利確幅（損切り幅の倍数） */
const NO_TARGET = 20;
const LUNCH_END = 12 * 60 + 30;

/**
 * 後場順張り。前場が momMinPct 以上動いた日に、後場の最初の足が確定したところで同じ向きに入り、
 * 大引け前の強制決済まで持つ。損切りは前場の値幅の半分。
 */
export const momentum: Strategy = (bars, s, fine = false) => {
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  // 後場の最初の足でだけ判定する
  if (jstMinutes(last.t) < LUNCH_END || jstMinutes(prev.t) >= LUNCH_END) return null;
  const morning = bars.filter((b) => jstMinutes(b.t) < LUNCH_END);
  const open = morning[0].o;
  const ret = ((prev.c - open) / open) * 100;
  const range = Math.max(...morning.map((b) => b.h)) - Math.min(...morning.map((b) => b.l));
  const risk = Math.max(range / 2, 2 * tickSize(last.c, fine));
  // 昼休みをはさんで向きが変わっていたら見送る
  if (ret >= s.momMinPct && last.c >= prev.c) {
    return { side: "long", stop: roundToTick(last.c - risk, "down", fine), target: roundToTick(last.c + risk * NO_TARGET, "up", fine) };
  }
  if (s.allowShort && ret <= -s.momMinPct && last.c <= prev.c) {
    return { side: "short", stop: roundToTick(last.c + risk, "up", fine), target: roundToTick(Math.max(last.c - risk * NO_TARGET, tickSize(1, fine)), "down", fine) };
  }
  return null;
};

/**
 * ギャップ埋め。前日終値から gapMinPct 以上離れて寄り付いた日に、最初の足が確定したところで
 * 前日終値へ戻る向きに入る。利確は前日終値、損切りは同じ幅だけ逆側。
 */
export const gapfade: Strategy = (bars, s, fine = false, ctx) => {
  const prevClose = ctx?.prevClose;
  if (bars.length !== 1 || prevClose == null) return null;
  const first = bars[0];
  if (jstMinutes(first.t) !== SESSION_OPEN) return null;
  const gap = ((first.o - prevClose) / prevClose) * 100;
  const dist = Math.abs(prevClose - first.c);
  if (dist < 2 * tickSize(first.c, fine)) return null;
  if (gap <= -s.gapMinPct && first.c < prevClose) {
    return { side: "long", stop: roundToTick(first.c - dist, "down", fine), target: roundToTick(prevClose, "down", fine) };
  }
  if (s.allowShort && gap >= s.gapMinPct && first.c > prevClose) {
    return { side: "short", stop: roundToTick(first.c + dist, "up", fine), target: roundToTick(prevClose, "up", fine) };
  }
  return null;
};

/**
 * VWAP押し目買い。始値より高く、それまでの足の7割以上がVWAPの上で引けている上昇日に、
 * 足がVWAPまで下げてからVWAPの上で引けたら買う。利確はその日の高値、損切りは押した足の安値の下。
 * 高値までの余地が損切り幅より小さいときは見送る。
 */
export const pullback: Strategy = (bars, s, fine = false) => {
  if (bars.length < 7) return null;
  let pv = 0;
  let vol = 0;
  let above = 0;
  let current = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const v = Math.max(b.v, 1);
    pv += ((b.h + b.l + b.c) / 3) * v;
    vol += v;
    current = pv / vol;
    if (i < bars.length - 1 && b.c > current) above++;
  }
  const last = bars[bars.length - 1];
  const open = bars[0].o;
  const tick = tickSize(last.c, fine);
  if (last.c <= open || current <= open || above / (bars.length - 1) < 0.7) return null;
  if (last.l > current + tick || last.c <= current) return null;
  const high = Math.max(...bars.map((b) => b.h));
  const stop = roundToTick(Math.min(last.l, current) - 2 * tick, "down", fine);
  const risk = last.c - stop;
  if (high - last.c < risk) return null;
  return { side: "long", stop, target: roundToTick(high, "down", fine) };
};

/** 安寄り買いと持ち越しは寄り付き・大引けの板寄せの値で売買するので、分足のエンジンではなく gapopen.ts が日足の値で動かす */
const daily: Strategy = () => null;

export const STRATEGIES: Record<Settings["strategy"], Strategy> = { orb, vwap, momentum, gapfade, pullback, gapopen: daily, overnight: daily, gapopen_overnight: daily };
