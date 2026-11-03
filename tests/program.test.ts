import { describe, expect, it } from 'vitest';
import { buildSegments, intervalProgram, makeStep, simpleProgram, totalDurationMs, type Program } from '../src/core/program';

describe('buildSegments', () => {
  it('単発タイマーは1区間', () => {
    const segs = buildSegments(simpleProgram(180));
    expect(segs).toHaveLength(1);
    expect(segs[0].durationMs).toBe(180_000);
    expect(totalDurationMs(segs)).toBe(180_000);
  });

  it('インターバル 1分→30秒 ×2 は既定で「ワーク→休憩」を2回（最後の休憩も含む）', () => {
    const segs = buildSegments(intervalProgram(60, 30, 2));
    expect(segs.map((s) => s.kind)).toEqual(['work', 'rest', 'work', 'rest']);
    expect(totalDurationMs(segs)).toBe(180_000);
  });

  it('skipLastRest=true なら 1分→30秒 ×3 は最後の休憩を省略して5区間', () => {
    const segs = buildSegments(intervalProgram(60, 30, 3, { skipLastRest: true }));
    expect(segs.map((s) => `${s.label}${s.round}`)).toEqual(['ワーク1', '休憩1', 'ワーク2', '休憩2', 'ワーク3']);
    expect(totalDurationMs(segs)).toBe(60_000 * 3 + 30_000 * 2);
    expect(segs[2].startMs).toBe(90_000);
  });

  it('skipLastRest=false なら最後の休憩も含む / 準備区間が先頭に入る', () => {
    const segs = buildSegments(intervalProgram(20, 10, 2, { skipLastRest: false, prepareSec: 5 }));
    expect(segs.map((s) => s.kind)).toEqual(['prepare', 'work', 'rest', 'work', 'rest']);
    expect(segs[0].round).toBe(0);
    expect(totalDurationMs(segs)).toBe(5_000 + 60_000);
  });

  it('長さ0のステップは飛ばす', () => {
    const p: Program = { ...simpleProgram(10), steps: [makeStep('A', 10), makeStep('B', 0, 'rest')], rounds: 2 };
    expect(buildSegments(p)).toHaveLength(2);
  });
});
