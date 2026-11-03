import type { Segment } from './program';

/**
 * ダイヤル1周が何を表すか。
 * - number N: N ラウンドごとに1周（1 ならワーク+休憩の1ラウンドで1周）
 * - 'all':    準備を除くプログラム全体で1周（インターバルを挟んだ全体を1周で表現）
 */
export type LapUnit = 'all' | number;

/** 初期値は「1ラウンド（ワーク+休憩）で1周」 */
export const DEFAULT_LAP: LapUnit = 1;

export interface Lap {
  index: number;
  startMs: number;
  durationMs: number;
  /** この周に含まれる区間（segments の index） */
  first: number;
  last: number;
}

/** 保存データの値を正規化する（以前あった「区間ごと」などは既定値に戻す） */
export function normalizeLap(v: unknown): LapUnit {
  if (v === 'all') return 'all';
  if (typeof v === 'number' && Number.isFinite(v) && v >= 1) return Math.floor(v);
  return DEFAULT_LAP;
}

/** 区間の列を「1周」単位にまとめる。準備区間は常に単独の1周 */
export function buildLaps(segments: Segment[], unit: LapUnit): Lap[] {
  const laps: Lap[] = [];
  let cur: Lap | null = null;
  let curKey = '';
  for (const s of segments) {
    let key: string;
    if (s.kind === 'prepare') key = `s${s.index}`;
    else if (unit === 'all') key = 'all';
    else key = `r${Math.floor((s.round - 1) / Math.max(1, unit))}`;

    if (!cur || key !== curKey) {
      cur = { index: laps.length, startMs: s.startMs, durationMs: 0, first: s.index, last: s.index };
      laps.push(cur);
      curKey = key;
    }
    cur.durationMs = s.startMs + s.durationMs - cur.startMs;
    cur.last = s.index;
  }
  return laps;
}

export function lapOf(laps: Lap[], segmentIndex: number): Lap | null {
  return laps.find((l) => segmentIndex >= l.first && segmentIndex <= l.last) ?? null;
}

/** 1周に含まれるラウンド数 */
export function roundsPerLap(unit: LapUnit, totalRounds: number): number {
  if (unit === 'all') return totalRounds;
  return Math.min(Math.max(1, unit), totalRounds);
}

export function lapLabel(unit: LapUnit, totalRounds: number): string {
  const n = roundsPerLap(unit, totalRounds);
  if (n >= totalRounds) return '全体';
  return `${n}回ごと`;
}

/** 編集バーのボタンで切り替える: 1回ごと ⇔ 全体（2回ごと等から押したら全体へ） */
export function nextLapUnit(unit: LapUnit, totalRounds: number): LapUnit {
  return roundsPerLap(unit, totalRounds) >= totalRounds ? 1 : 'all';
}
