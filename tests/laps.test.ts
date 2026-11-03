import { describe, expect, it } from 'vitest';
import { buildLaps, lapOf } from '../src/core/laps';
import { buildSegments, intervalProgram } from '../src/core/program';

// ワーク1分 → 休憩30秒 ×3（既定: 最後の休憩も含む）+ 準備5秒
const segs = buildSegments(intervalProgram(60, 30, 3, { prepareSec: 5 }));

describe('buildLaps', () => {
  it("'all': 準備を除く全体（インターバルを挟んだ全部）で1周", () => {
    const laps = buildLaps(segs, 'all');
    expect(laps).toHaveLength(2);
    expect(laps[0]).toMatchObject({ startMs: 0, durationMs: 5_000 }); // 準備
    expect(laps[1]).toMatchObject({ startMs: 5_000, durationMs: 90_000 * 3, first: 1, last: 6 });
  });

  it('1: 1ラウンド（ワーク+休憩）で1周', () => {
    const laps = buildLaps(segs, 1);
    expect(laps.map((l) => l.durationMs)).toEqual([5_000, 90_000, 90_000, 90_000]);
  });

  it('2: 2ラウンドで1周', () => {
    const laps = buildLaps(segs, 2);
    expect(laps.map((l) => l.durationMs)).toEqual([5_000, 180_000, 90_000]);
  });

  it('最後の休憩を省略した場合、最後の周はワークだけになる', () => {
    const skipped = buildSegments(intervalProgram(60, 30, 2, { skipLastRest: true }));
    expect(buildLaps(skipped, 1).map((l) => l.durationMs)).toEqual([90_000, 60_000]);
  });

  it('lapOf で区間が属する周を引ける', () => {
    const laps = buildLaps(segs, 1);
    expect(lapOf(laps, 0)?.index).toBe(0);
    expect(lapOf(laps, 3)?.index).toBe(2);
  });
});
