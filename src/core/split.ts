/**
 * 「全体の時間を、ワークと休憩の割合で分ける」編集のための純粋関数。
 * どの操作も1サイクルの長さ（= 合計 ÷ 繰り返し回数）を変えずに区間の配分だけを変える。
 */

import { fineStep } from './dialScale';
import { makeStep, type Step, type StepKind } from './program';

/** 1サイクルの長さに応じた刻み（〜10分: 5秒 / 〜1時間: 15秒 / それ以上: 1分） */
export function unitFor(cycleSec: number): number {
  if (cycleSec <= 600) return 5;
  if (cycleSec <= 3600) return 15;
  return 60;
}

/**
 * 合計時間（= 1サイクル × rounds）を1段階増減した値を返す。
 * 各サイクルが刻みの整数倍になるよう、増減幅は rounds × 刻み の倍数にそろえる。
 */
export function nudgeTotal(totalSec: number, rounds: number, direction: 1 | -1, minCycleSec: number): number {
  const unit = unitFor(totalSec / rounds);
  const q = rounds * unit;
  const step = Math.ceil(fineStep(totalSec, direction) / q) * q;
  const aligned = direction > 0 ? Math.floor(totalSec / q) * q + step : Math.ceil(totalSec / q) * q - step;
  return Math.max(Math.ceil(minCycleSec / unit) * unit * rounds, aligned);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * 隣り合う2区間 a, b（b は a の次。サイクルをまたぐ場合は a=最後, b=0）の配分を変える。
 * a の長さを newA にし、その分 b を縮める（2区間の合計は変わらない）。
 */
export function resizePair(durations: number[], a: number, b: number, newA: number, unit: number): number[] {
  if (a === b || !(a in durations) || !(b in durations)) return durations;
  const pair = durations[a] + durations[b];
  const min = Math.min(unit, Math.floor(pair / 2));
  const v = Math.min(pair - min, Math.max(min, Math.round(newA / unit) * unit));
  if (v === durations[a]) return durations;
  const next = [...durations];
  next[a] = v;
  next[b] = pair - v;
  return next;
}

/**
 * 区間 i と i+1 の境目を、サイクル先頭から boundarySec の位置に動かす。
 * 2つの区間の合計は変わらない（片方が伸びた分もう片方が縮む）。
 */
export function moveBoundary(durations: number[], i: number, boundarySec: number, unit: number): number[] {
  if (i < 0 || i >= durations.length - 1) return durations;
  return resizePair(durations, i, i + 1, boundarySec - sum(durations.slice(0, i)), unit);
}

/**
 * 区間の比率を保ったまま、1サイクルの長さを newCycleSec にする。
 * 各区間は unit 秒単位に丸め、丸めの誤差は一番長い区間で吸収する。
 */
export function scaleDurations(durations: number[], newCycleSec: number, unit: number): number[] {
  const old = sum(durations);
  const target = Math.max(unit * durations.length, Math.round(newCycleSec / unit) * unit);
  if (old <= 0) return durations.map(() => Math.round(target / durations.length));
  const next = durations.map((d) => Math.max(unit, Math.round((d * target) / old / unit) * unit));
  const diff = target - sum(next);
  if (diff !== 0) {
    const iMax = next.indexOf(Math.max(...next));
    next[iMax] = Math.max(unit, next[iMax] + diff);
  }
  return next;
}

const opposite = (k: StepKind): StepKind => (k === 'rest' ? 'work' : 'rest');
const defaultLabel = (k: StepKind) => (k === 'rest' ? '休憩' : 'ワーク');

/**
 * 区間 index の真ん中に、反対の種類の区間を差し込む（ワークの中に休憩を入れる）。
 * 差し込む区間は元の長さの 1/4。合計は変わらない。分けられないほど短ければ null。
 */
export function insertInto(steps: Step[], index: number, unit: number): { steps: Step[]; inserted: number } | null {
  const s = steps[index];
  if (!s || s.durationSec < unit * 3) return null;
  const mid = Math.max(unit, Math.round(s.durationSec / 4 / unit) * unit);
  const restOf = s.durationSec - mid;
  const a = Math.max(unit, Math.round(restOf / 2 / unit) * unit);
  const c = restOf - a;
  if (c < unit) return null;
  const kind = opposite(s.kind);
  const next = [
    ...steps.slice(0, index),
    { ...s, durationSec: a },
    makeStep(defaultLabel(kind), mid, kind),
    { ...makeStep(s.label, c, s.kind) },
    ...steps.slice(index + 1),
  ];
  return { steps: next, inserted: index + 1 };
}

/**
 * 区間 index を消し、その時間を前の区間（先頭なら次の区間）に足す。
 * 消した結果、同じ種類の区間が隣り合ったら1つにまとめる。合計は変わらない。
 */
export function removeAt(steps: Step[], index: number): { steps: Step[]; selected: number } | null {
  if (steps.length <= 1 || !steps[index]) return null;
  const target = index > 0 ? index - 1 : 1;
  const merged = steps.map((s, i) => (i === target ? { ...s, durationSec: s.durationSec + steps[index].durationSec } : s));
  let next = merged.filter((_, i) => i !== index);
  let selected = index > 0 ? index - 1 : 0;
  // 隣り合う同じ種類をまとめる
  const out: Step[] = [];
  next.forEach((s, i) => {
    const prev = out[out.length - 1];
    if (prev && prev.kind === s.kind) {
      out[out.length - 1] = { ...prev, durationSec: prev.durationSec + s.durationSec };
      if (i <= selected) selected -= 1;
    } else out.push(s);
  });
  next = out;
  return { steps: next, selected: Math.max(0, Math.min(selected, next.length - 1)) };
}

/** 1サイクル内のワーク/休憩の割合（%） */
export function shares(steps: { kind: StepKind; durationSec: number }[]): { work: number; rest: number } {
  const total = steps.reduce((a, s) => a + s.durationSec, 0) || 1;
  const rest = steps.filter((s) => s.kind === 'rest').reduce((a, s) => a + s.durationSec, 0);
  const restPct = Math.round((rest / total) * 100);
  return { work: 100 - restPct, rest: restPct };
}
