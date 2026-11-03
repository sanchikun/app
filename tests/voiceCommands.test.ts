import { describe, expect, it } from 'vitest';
import { normalizeTranscript, parseVoiceCommand } from '../src/core/voiceCommands';

describe('normalizeTranscript', () => {
  it('漢数字・全角・「半」を正規化', () => {
    expect(normalizeTranscript('三分')).toBe('3分');
    expect(normalizeTranscript('二十五分')).toBe('25分');
    expect(normalizeTranscript('百二十秒')).toBe('120秒');
    expect(normalizeTranscript('１分半')).toBe('1分30秒');
    expect(normalizeTranscript('十五秒')).toBe('15秒');
  });
});

describe('parseVoiceCommand', () => {
  const cases: [string, unknown][] = [
    ['スタート', { type: 'start' }],
    ['開始して', { type: 'start' }],
    ['はじめて', { type: 'start' }],
    ['ストップ', { type: 'pause' }],
    ['止めて', { type: 'pause' }],
    ['一時停止', { type: 'pause' }],
    ['ちょっと待って', { type: 'pause' }],
    ['再開', { type: 'resume' }],
    ['続けて', { type: 'resume' }],
    ['リセット', { type: 'reset' }],
    ['次', { type: 'skip' }],
    ['スキップして', { type: 'skip' }],
    ['戻って', { type: 'previous' }],
    ['残りは？', { type: 'status' }],
    ['あと何分', { type: 'status' }],
    ['3分タイマー', { type: 'set', durationSec: 180, autoStart: true }],
    ['三分', { type: 'set', durationSec: 180, autoStart: true }],
    ['1分30秒', { type: 'set', durationSec: 90, autoStart: true }],
    ['1分半', { type: 'set', durationSec: 90, autoStart: true }],
    ['5分にセットして', { type: 'set', durationSec: 300, autoStart: false }],
    ['1時間', { type: 'set', durationSec: 3600, autoStart: true }],
    ['1分追加', { type: 'add', deltaSec: 60 }],
    ['30秒延長', { type: 'add', deltaSec: 30 }],
    ['延長して', { type: 'add', deltaSec: 60 }],
    ['1分と30秒のインターバル5回', { type: 'interval', workSec: 60, restSec: 30, rounds: 5, autoStart: true }],
    ['ワーク40秒 休憩20秒 8セット', { type: 'interval', workSec: 40, restSec: 20, rounds: 8, autoStart: true }],
    ['休憩10秒ワーク20秒', { type: 'interval', workSec: 20, restSec: 10, rounds: 10, autoStart: true }],
    ['30秒インターバル', { type: 'interval', workSec: 30, restSec: 30, rounds: 10, autoStart: true }],
    ['ヘルプ', { type: 'help' }],
    ['start', { type: 'start' }],
    ['3 minutes', { type: 'set', durationSec: 180, autoStart: true }],
  ];
  it.each(cases)('「%s」', (input, expected) => {
    expect(parseVoiceCommand(input)).toEqual(expected);
  });

  it('関係ない発話は null', () => {
    expect(parseVoiceCommand('今日はいい天気ですね')).toBeNull();
    expect(parseVoiceCommand('')).toBeNull();
  });

  it('タイマー自身の読み上げ「残り30秒」はセットではなく状態確認として扱う', () => {
    expect(parseVoiceCommand('残り30秒')).toEqual({ type: 'status' });
  });
});
