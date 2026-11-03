/**
 * 音声認識の結果（文字列）をタイマー操作コマンドに変換する。
 * Web Speech API でもスマホのネイティブ音声認識でも、文字列さえ得られれば同じパーサを使える。
 */

export type VoiceCommand =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }
  | { type: 'skip' }
  | { type: 'previous' }
  | { type: 'status' }
  | { type: 'set'; durationSec: number; autoStart: boolean }
  | { type: 'add'; deltaSec: number }
  | { type: 'interval'; workSec: number; restSec: number; rounds: number; autoStart: boolean }
  | { type: 'help' };

const KANJI_DIGITS: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const KANJI_UNITS: Record<string, number> = { 十: 10, 百: 100 };

/** 「二十五」→ 25、「百二十」→ 120 のように漢数字を数値にする */
function kanjiToNumber(src: string): number {
  let total = 0;
  let current = 0;
  for (const ch of src) {
    if (ch in KANJI_DIGITS) {
      current = current * 10 + KANJI_DIGITS[ch];
    } else if (ch in KANJI_UNITS) {
      total += (current || 1) * KANJI_UNITS[ch];
      current = 0;
    }
  }
  return total + current;
}

/** 全角→半角、漢数字→算用数字、空白除去などの正規化 */
export function normalizeTranscript(text: string): string {
  let s = text.normalize('NFKC').toLowerCase();
  s = s.replace(/[〇零一二三四五六七八九十百]+/g, (m) => String(kanjiToNumber(m)));
  // 「半」は 30 秒 / 0.5 分として扱う（例: 1分半）
  s = s.replace(/(\d+)分半/g, (_, m: string) => `${m}分30秒`);
  s = s.replace(/[\s、。,.!?！？]/g, '');
  return s;
}

/** 「1分30秒」「90秒」「2分」「1時間」などから秒数を取り出す。見つからなければ null */
function parseDuration(s: string): { sec: number; rest: string } | null {
  const re = /(?:(\d+)時間)?(?:(\d+)分)?(?:(\d+)秒)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[0] === '') {
      re.lastIndex += 1;
      continue;
    }
    const sec = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
    if (sec > 0) return { sec, rest: s.slice(0, m.index) + s.slice(m.index + m[0].length) };
  }
  // 英語: "3 minutes", "30 seconds"
  const en = /(\d+)(minutes?|mins?|seconds?|secs?)/.exec(s);
  if (en) {
    const n = Number(en[1]);
    const sec = en[2].startsWith('m') ? n * 60 : n;
    return { sec, rest: s.replace(en[0], '') };
  }
  return null;
}

function parseAllDurations(s: string): { secs: number[]; rest: string } {
  const secs: number[] = [];
  let rest = s;
  for (let i = 0; i < 4; i += 1) {
    const d = parseDuration(rest);
    if (!d) break;
    secs.push(d.sec);
    rest = d.rest;
  }
  return { secs, rest };
}

const has = (s: string, words: string[]) => words.some((w) => s.includes(w));

const WORDS = {
  start: ['スタート', 'すたーと', '開始', 'かいし', 'はじめ', '始め', 'start', 'go'],
  pause: ['ストップ', 'すとっぷ', '止め', 'とめ', 'やめ', '止ま', 'とま', '停止', 'ていし', 'ポーズ', '待って', 'まって', 'stop', 'pause'],
  resume: ['再開', 'さいかい', '続け', 'つづけ', 'resume', 'continue'],
  reset: ['リセット', 'りせっと', 'やり直', 'やりなお', 'クリア', 'reset', 'clear'],
  skip: ['スキップ', 'すきっぷ', '次', 'つぎ', 'skip', 'next'],
  previous: ['戻って', 'もどって', '前へ', '前の', 'back', 'previous'],
  status: ['残り', 'のこり', 'あと何', 'あとなん', '何分', 'なんぷん', '何秒', 'なんびょう', '今どこ', 'いまどこ', 'status', 'remaining', 'howmuch'],
  add: ['追加', 'ついか', '延長', 'えんちょう', 'プラス', 'ぷらす', '足して', 'たして', 'add', 'more', 'plus'],
  interval: ['インターバル', 'いんたーばる', '交互', 'こうご', '繰り返', 'くりかえ', 'interval', 'repeat'],
  help: ['ヘルプ', 'へるぷ', '使い方', 'つかいかた', 'help', '何ができる', 'なにができる'],
};

/** 文字列からコマンドを解釈する。解釈できなければ null */
export function parseVoiceCommand(transcript: string): VoiceCommand | null {
  const s = normalizeTranscript(transcript);
  if (!s) return null;

  // 1) 時間の延長: 「1分追加」「30秒延長」
  if (has(s, WORDS.add)) {
    const d = parseDuration(s);
    if (d) return { type: 'add', deltaSec: d.sec };
    return { type: 'add', deltaSec: 60 };
  }

  // 2) インターバル: 「1分と30秒のインターバル 5回」「ワーク40秒 休憩20秒 8セット」
  const { secs, rest } = parseAllDurations(s);
  if (secs.length >= 2 || (secs.length >= 1 && has(s, WORDS.interval))) {
    const roundsMatch = /(\d+)(?:回|セット|ラウンド|周|rounds?|sets?|times)/.exec(rest);
    const rounds = roundsMatch ? Math.max(1, Number(roundsMatch[1])) : 0;
    if (secs.length >= 2) {
      // 「休憩」「レスト」の語が前にある方を休憩として扱う（無ければ 1つ目=ワーク, 2つ目=休憩）
      let [workSec, restSec] = secs;
      const restIdx = Math.max(s.indexOf('休憩'), s.indexOf('きゅうけい'), s.indexOf('レスト'), s.indexOf('rest'));
      const workIdx = Math.max(s.indexOf('ワーク'), s.indexOf('運動'), s.indexOf('work'));
      if (restIdx >= 0 && workIdx >= 0 && restIdx < workIdx) [workSec, restSec] = [restSec, workSec];
      return {
        type: 'interval',
        workSec,
        restSec,
        rounds: rounds || 10,
        autoStart: !has(s, ['セットして', '設定して', 'set']),
      };
    }
    if (has(s, WORDS.interval)) {
      // 時間1つ + 「インターバル」→ 同じ長さのワークと休憩
      return { type: 'interval', workSec: secs[0], restSec: secs[0], rounds: rounds || 10, autoStart: true };
    }
  }

  // 3) 残り時間の確認（「残り何分？」に数字が含まれていても先に判定する）
  if (has(s, WORDS.status)) return { type: 'status' };

  // 4) 時間指定: 「3分」「3分タイマー」「1分30秒でスタート」
  if (secs.length === 1) {
    const setOnly = has(s, ['セットして', '設定して', 'セット', 'set']) && !has(s, WORDS.start);
    return { type: 'set', durationSec: secs[0], autoStart: !setOnly };
  }

  // 5) 単語コマンド（「止めて」を「始めて」より先に判定）
  if (has(s, WORDS.reset)) return { type: 'reset' };
  if (has(s, WORDS.pause)) return { type: 'pause' };
  if (has(s, WORDS.resume)) return { type: 'resume' };
  if (has(s, WORDS.skip)) return { type: 'skip' };
  if (has(s, WORDS.previous)) return { type: 'previous' };
  if (has(s, WORDS.start)) return { type: 'start' };
  if (has(s, WORDS.help)) return { type: 'help' };
  return null;
}

export const VOICE_HELP_TEXT =
  '例えば、3分タイマー、スタート、ストップ、再開、リセット、次へ、残りは、1分追加、' +
  '1分と30秒のインターバル5回、のように話しかけてください';
