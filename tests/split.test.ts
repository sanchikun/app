import { describe, expect, it } from 'vitest';
import { makeStep } from '../src/core/program';
import { insertInto, moveBoundary, resizePair, nudgeTotal, removeAt, scaleDurations, shares, unitFor } from '../src/core/split';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('moveBoundary', () => {
  it('境目を動かしても2区間の合計は変わらない', () => {
    expect(moveBoundary([60, 30], 0, 70, 5)).toEqual([70, 20]);
    expect(moveBoundary([60, 30], 0, 47, 5)).toEqual([45, 45]);
  });
  it('どちらも最小幅より短くならない', () => {
    expect(moveBoundary([60, 30], 0, 200, 5)).toEqual([85, 5]);
    expect(moveBoundary([60, 30], 0, -10, 5)).toEqual([5, 85]);
  });
  it('3区間の真ん中の境目は、前後の区間だけを変える', () => {
    expect(moveBoundary([60, 30, 60], 1, 100, 5)).toEqual([60, 40, 50]);
  });
});

describe('resizePair', () => {
  it('サイクルをまたぐ境目（最後の休憩 → 次のワーク）でも配分を変えられる', () => {
    expect(resizePair([60, 30], 1, 0, 40, 5)).toEqual([50, 40]);
    expect(resizePair([60], 0, 0, 40, 5)).toEqual([60]);
  });
});

describe('scaleDurations', () => {
  it('比率を保ったまま長さを変え、合計はぴったり', () => {
    const r = scaleDurations([60, 30], 180, 5);
    expect(r).toEqual([120, 60]);
    const r2 = scaleDurations([60, 30, 45], 100, 5);
    expect(sum(r2)).toBe(100);
  });
});

describe('insertInto / removeAt', () => {
  it('ワークの真ん中に休憩を差し込む（合計は同じ）', () => {
    const steps = [makeStep('ワーク', 120, 'work'), makeStep('休憩', 30, 'rest')];
    const r = insertInto(steps, 0, 5)!;
    expect(r.steps.map((s) => `${s.kind}:${s.durationSec}`)).toEqual(['work:45', 'rest:30', 'work:45', 'rest:30']);
    expect(r.inserted).toBe(1);
    expect(sum(r.steps.map((s) => s.durationSec))).toBe(150);
  });
  it('短すぎる区間には差し込めない', () => {
    expect(insertInto([makeStep('ワーク', 10, 'work')], 0, 5)).toBeNull();
  });
  it('区間を消すと時間は前の区間へ。同じ種類が隣り合えばまとめる', () => {
    const steps = [makeStep('ワーク', 45, 'work'), makeStep('休憩', 30, 'rest'), makeStep('ワーク', 45, 'work'), makeStep('休憩', 30, 'rest')];
    const r = removeAt(steps, 1)!;
    expect(r.steps.map((s) => `${s.kind}:${s.durationSec}`)).toEqual(['work:120', 'rest:30']);
    expect(r.selected).toBe(0);
    expect(removeAt([steps[0]], 0)).toBeNull();
  });
});

describe('nudgeTotal', () => {
  it('×4 なら増減幅は 4×刻み の倍数（各サイクルが刻みの整数倍のまま）', () => {
    expect(nudgeTotal(480, 4, 1, 10)).toBe(520); // 8:00 → 8:40（1サイクル 2:00 → 2:10）
    expect(nudgeTotal(480, 4, -1, 10)).toBe(440);
    expect(nudgeTotal(90, 1, 1, 10)).toBe(105);
    expect(nudgeTotal(20, 1, -1, 10)).toBe(15);
    expect(nudgeTotal(10, 1, -1, 10)).toBe(10); // 最小より短くしない
  });
  it('比率を保って ×5 → ×4 にしても比率が大きく崩れない', () => {
    const r = scaleDurations([25, 20, 25, 20], 450 / 4, unitFor(450 / 4));
    expect(r).toEqual([35, 25, 30, 25]); // 合計 115（= 1サイクル 1:55）
  });
});

describe('misc', () => {
  it('unitFor / shares', () => {
    expect(unitFor(90)).toBe(5);
    expect(unitFor(1800)).toBe(15);
    expect(unitFor(5400)).toBe(60);
    expect(shares([{ kind: 'work', durationSec: 60 }, { kind: 'rest', durationSec: 30 }])).toEqual({ work: 67, rest: 33 });
  });
});
