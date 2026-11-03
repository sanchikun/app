import { describe, expect, it } from 'vitest';
import { angleFrac, expandScale, fitScale, nudge, scaleLabel, snap, snapFor, unwrapDelta } from '../src/core/dialScale';

describe('dialScale', () => {
  it('fitScale: 合計が1周の90%以内に収まる最小スケール', () => {
    expect(fitScale(90)).toBe(120); // 1分+30秒 → 1周2分
    expect(fitScale(30)).toBe(60); // タバタ 20+10 → 1周1分
    expect(fitScale(180, 300)).toBe(300); // 3分 → 1周5分
    expect(fitScale(25 * 60 + 5 * 60)).toBe(3600);
    expect(fitScale(0, 300)).toBe(300);
    expect(fitScale(999999)).toBe(10800);
  });

  it('expandScale: はみ出したときだけ広げる', () => {
    expect(expandScale(300, 200)).toBe(300);
    expect(expandScale(300, 301)).toBe(600);
    expect(expandScale(120, 100)).toBe(120);
  });

  it('snap', () => {
    expect(snapFor(120)).toBe(5);
    expect(snap(47, 5)).toBe(45);
    expect(snap(48, 5)).toBe(50);
  });

  it('nudge: 短い時間ほど細かく、刻みに揃える', () => {
    expect(nudge(60, 1)).toBe(75);
    expect(nudge(60, -1)).toBe(55);
    expect(nudge(30, 1)).toBe(35);
    expect(nudge(62, 1)).toBe(75);
    expect(nudge(300, 1)).toBe(330);
    expect(nudge(5, -1, 5)).toBe(5);
    expect(nudge(0, -1)).toBe(0);
  });

  it('unwrapDelta: 12時をまたいでも連続した差分になる', () => {
    expect(unwrapDelta(0.95, 0.05)).toBeCloseTo(0.1);
    expect(unwrapDelta(0.05, 0.95)).toBeCloseTo(-0.1);
    expect(unwrapDelta(0.2, 0.3)).toBeCloseTo(0.1);
  });

  it('angleFrac: 12時=0, 3時=0.25, 6時=0.5, 9時=0.75', () => {
    expect(angleFrac(0, 0, 0, -1)).toBeCloseTo(0);
    expect(angleFrac(0, 0, 1, 0)).toBeCloseTo(0.25);
    expect(angleFrac(0, 0, 0, 1)).toBeCloseTo(0.5);
    expect(angleFrac(0, 0, -1, 0)).toBeCloseTo(0.75);
  });

  it('scaleLabel', () => {
    expect(scaleLabel(30, 120)).toBe('0:30');
    expect(scaleLabel(900, 3600)).toBe('15分');
    expect(scaleLabel(225, 900)).toBe('3:45');
    expect(scaleLabel(450, 900)).toBe('7:30');
    expect(scaleLabel(3600, 7200)).toBe('1時間');
    expect(scaleLabel(5400, 10800)).toBe('1:30');
  });
});
