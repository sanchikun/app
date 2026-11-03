import type { Segment } from './program';

/**
 * ダイヤル1周（バーなら全幅）が何を表すか。
 * 画面では常に 'all'（準備を除くプログラム全体で1周）を使う。N ならNラウンドごと。
 */
export type LapUnit = 'all' | number;

export interface Lap {
  index: number;
  startMs: number;
  durationMs: number;
  /** この周に含まれる区間（segments の index） */
  first: number;
  last: number;
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
