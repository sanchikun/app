import { describe, expect, it } from 'vitest';
import { TimerEngine } from '../src/core/engine';
import { intervalProgram, simpleProgram } from '../src/core/program';

function fakeClock() {
  let t = 0;
  const clock = () => t;
  return { clock, advance: (ms: number) => (t += ms) };
}

describe('TimerEngine', () => {
  it('開始・一時停止・再開で経過時間が正しく積み上がる', () => {
    const c = fakeClock();
    const e = new TimerEngine(simpleProgram(60), c.clock);
    expect(e.getSnapshot().status).toBe('idle');
    e.start();
    c.advance(10_000);
    expect(e.getSnapshot().segmentRemainingMs).toBe(50_000);
    e.pause();
    c.advance(30_000);
    expect(e.getSnapshot().segmentRemainingMs).toBe(50_000);
    expect(e.getSnapshot().status).toBe('paused');
    e.start();
    c.advance(5_000);
    expect(e.getSnapshot().segmentRemainingMs).toBe(45_000);
    expect(e.getSnapshot().segmentProgress).toBeCloseTo(0.25);
  });

  it('時間が来たら finished になる', () => {
    const c = fakeClock();
    const e = new TimerEngine(simpleProgram(3), c.clock);
    e.start();
    c.advance(5_000);
    const s = e.getSnapshot();
    expect(s.status).toBe('finished');
    expect(s.totalRemainingMs).toBe(0);
  });

  it('インターバルで区間が切り替わる', () => {
    const c = fakeClock();
    const e = new TimerEngine(intervalProgram(60, 30, 2, { skipLastRest: true }), c.clock);
    e.start();
    c.advance(61_000);
    let s = e.getSnapshot();
    expect(s.segment?.label).toBe('休憩');
    expect(s.segmentRemainingMs).toBe(29_000);
    c.advance(30_000);
    s = e.getSnapshot();
    expect(s.segment?.label).toBe('ワーク');
    expect(s.segment?.round).toBe(2);
  });

  it('skip で次の区間へ、最後の区間で skip すると終了', () => {
    const c = fakeClock();
    const e = new TimerEngine(intervalProgram(60, 30, 2, { skipLastRest: true }), c.clock);
    e.start();
    c.advance(5_000);
    e.skip();
    expect(e.getSnapshot().segment?.label).toBe('休憩');
    expect(e.getSnapshot().segmentElapsedMs).toBe(0);
    e.skip();
    e.skip();
    expect(e.getSnapshot().status).toBe('finished');
  });

  it('previous は区間の頭へ、頭付近ならさらに前の区間へ', () => {
    const c = fakeClock();
    const e = new TimerEngine(intervalProgram(60, 30, 2, { skipLastRest: true }), c.clock);
    e.start();
    c.advance(70_000); // 休憩の10秒目
    e.previous();
    expect(e.getSnapshot().segment?.label).toBe('休憩');
    expect(e.getSnapshot().segmentElapsedMs).toBe(0);
    e.previous();
    expect(e.getSnapshot().segment?.label).toBe('ワーク');
    expect(e.getSnapshot().elapsedMs).toBe(0);
  });

  it('addTime で現在区間が伸び、以降の区間が後ろにずれる', () => {
    const c = fakeClock();
    const e = new TimerEngine(intervalProgram(60, 30, 2, { skipLastRest: true }), c.clock);
    e.start();
    c.advance(50_000);
    e.addTime(60_000);
    const s = e.getSnapshot();
    expect(s.segmentRemainingMs).toBe(70_000);
    expect(s.segments[1].startMs).toBe(120_000);
    expect(s.totalMs).toBe(210_000);
  });

  it('終了後の addTime はその場で再開する', () => {
    const c = fakeClock();
    const e = new TimerEngine(simpleProgram(10), c.clock);
    e.start();
    c.advance(20_000);
    expect(e.getSnapshot().status).toBe('finished');
    e.addTime(60_000);
    const s = e.getSnapshot();
    expect(s.status).toBe('running');
    expect(s.segmentRemainingMs).toBe(60_000);
  });

  it('finished から start すると最初から', () => {
    const c = fakeClock();
    const e = new TimerEngine(simpleProgram(10), c.clock);
    e.start();
    c.advance(11_000);
    e.getSnapshot();
    e.start();
    expect(e.getSnapshot().segmentRemainingMs).toBe(10_000);
    expect(e.getSnapshot().status).toBe('running');
  });
});
