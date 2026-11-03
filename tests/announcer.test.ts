import { describe, expect, it } from 'vitest';
import { defaultAnnounceSettings, detectCues, type Cue } from '../src/core/announcer';
import { TimerEngine, type TimerSnapshot } from '../src/core/engine';
import { cueToSpeech } from '../src/core/format';
import { intervalProgram, simpleProgram, type Program } from '../src/core/program';

/** 100ms 刻みでタイマーを進め、発生した合図を時刻付きで集める */
function simulate(program: Program, untilMs: number, settings = defaultAnnounceSettings) {
  let t = 0;
  const e = new TimerEngine(program, () => t);
  let prev: TimerSnapshot | null = e.getSnapshot();
  const out: { t: number; cue: Cue; text: string | null }[] = [];
  e.start();
  for (; t <= untilMs; t += 100) {
    const cur = e.getSnapshot();
    for (const cue of detectCues(prev, cur, settings)) out.push({ t, cue, text: cueToSpeech(cue, cur) });
    prev = cur;
  }
  return out;
}

describe('detectCues', () => {
  it('3分タイマー: 開始, 残り1分, 30秒, 10秒, 3-2-1, 終了', () => {
    const texts = simulate(simpleProgram(180), 181_000).map((c) => c.text);
    expect(texts).toEqual(['スタート。3分', '残り1分', '残り30秒', '残り10秒', '3', '2', '1', '時間になりました']);
  });

  it('合図のタイミングが正しい', () => {
    const cues = simulate(simpleProgram(60), 61_000);
    const at = (text: string) => cues.find((c) => c.text === text)?.t;
    expect(at('残り30秒')).toBe(30_000);
    expect(at('3')).toBe(57_000);
    expect(at('時間になりました')).toBe(60_000);
    // 1分ちょうどのタイマーで「残り1分」は言わない
    expect(at('残り1分')).toBeUndefined();
  });

  it('インターバル: 区間の切り替えを読み上げる / 短い休憩で「残り30秒」は言わない', () => {
    const texts = simulate(intervalProgram(60, 30, 2, { skipLastRest: true }), 151_000).map((c) => c.text);
    expect(texts).toEqual([
      'スタート。ラウンド1。ワーク、1分',
      '残り30秒',
      '残り10秒',
      '3', '2', '1',
      '休憩、30秒',
      '残り10秒',
      '3', '2', '1',
      '最終ラウンド。ワーク、1分',
      '残り30秒',
      '残り10秒',
      '3', '2', '1',
      '終了です。お疲れさまでした',
    ]);
  });

  it('毎分・半分経過の設定', () => {
    const settings = { ...defaultAnnounceSettings, everyMinute: true, halfway: true, countdown: 0, last10: false, last30: false };
    const texts = simulate(simpleProgram(300), 301_000, settings).map((c) => c.text);
    expect(texts).toEqual(['スタート。5分', '残り4分', '残り3分', '半分経過', '残り2分', '残り1分', '時間になりました']);
  });

  it('時間が大きく飛んだ（バックグラウンド復帰）ときは残り時間を読み上げない', () => {
    let t = 0;
    const e = new TimerEngine(simpleProgram(120), () => t);
    e.start();
    const prev = e.getSnapshot();
    t = 95_000; // 残り25秒まで一気に進む
    expect(detectCues(prev, e.getSnapshot(), defaultAnnounceSettings)).toEqual([]);
  });

  it('一時停止→再開では開始の案内を繰り返さない', () => {
    let t = 0;
    const e = new TimerEngine(simpleProgram(120), () => t);
    e.start();
    t = 1000;
    e.pause();
    const paused = e.getSnapshot();
    e.start();
    t = 1100;
    expect(detectCues(paused, e.getSnapshot(), defaultAnnounceSettings)).toEqual([]);
  });
});
