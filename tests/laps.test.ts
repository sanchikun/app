import { describe, expect, it } from 'vitest';
import { buildLaps, lapLabel, lapOf, nextLapUnit, roundsPerLap } from '../src/core/laps';
import { buildSegments, intervalProgram } from '../src/core/program';

// ワーク1分 → 休憩30秒 ×3（最後の休憩は省略）+ 準備5秒
const segs = buildSegments(intervalProgram(60, 30, 3, { prepareSec: 5 }));

describe('buildLaps', () => {
  it("'all': 準備を除く全体（インターバルを挟んだ全部）で1周", () => {
    const laps = buildLaps(segs, 'all');
    expect(laps).toHaveLength(2);
    expect(laps[0]).toMatchObject({ startMs: 0, durationMs: 5_000 }); // 準備
    expect(laps[1]).toMatchObject({ startMs: 5_000, durationMs: 60_000 * 3 + 30_000 * 2, first: 1, last: 5 });
  });

  it('1: 1ラウンド（ワーク+休憩）で1周', () => {
    const laps = buildLaps(segs, 1);
    expect(laps.map((l) => l.durationMs)).toEqual([5_000, 90_000, 90_000, 60_000]);
  });

  it('2: 2ラウンドで1周', () => {
    const laps = buildLaps(segs, 2);
    expect(laps.map((l) => l.durationMs)).toEqual([5_000, 180_000, 60_000]);
  });

  it("'segment': 区間ごとに1周", () => {
    expect(buildLaps(segs, 'segment')).toHaveLength(segs.length);
  });

  it('lapOf で区間が属する周を引ける', () => {
    const laps = buildLaps(segs, 1);
    expect(lapOf(laps, 0)?.index).toBe(0);
    expect(lapOf(laps, 3)?.index).toBe(2);
  });
});

describe('lap helpers', () => {
  it('表示名と切り替え順（全体 → 1回 → 区間 → 全体）', () => {
    expect(lapLabel('all', 5)).toBe('全体');
    expect(lapLabel(1, 5)).toBe('1回ごと');
    expect(lapLabel(5, 5)).toBe('全体');
    expect(lapLabel('segment', 5)).toBe('区間ごと');
    expect(nextLapUnit('all', 5)).toBe(1);
    expect(nextLapUnit(1, 5)).toBe('segment');
    expect(nextLapUnit(2, 5)).toBe('segment');
    expect(nextLapUnit('segment', 5)).toBe('all');
    // 1回しか繰り返さないなら「1回」と「全体」は同じなので飛ばす
    expect(nextLapUnit('all', 1)).toBe('segment');
    expect(roundsPerLap(10, 3)).toBe(3);
  });
});
