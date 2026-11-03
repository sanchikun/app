import type { Cue } from './announcer';
import type { TimerSnapshot } from './engine';
import type { Segment } from './program';

/** 表示用の残り時間。0.2秒残っていれば「0:01」と表示するよう切り上げる */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/** 読み上げ用の時間表現（例: 90秒 → 「1分30秒」） */
export function speakDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total === 0) return '0秒';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h ? `${h}時間` : ''}${m ? `${m}分` : ''}${s ? `${s}秒` : ''}`;
}

/** 秒数を短い表示に（例: 90 → 「1:30」, 30 → 「30秒」, 60 → 「1分」） */
export function shortDuration(sec: number): string {
  if (sec < 60) return `${sec}秒`;
  if (sec % 60 === 0) return `${sec / 60}分`;
  return formatClock(sec * 1000);
}

function roundPrefix(seg: Segment): string {
  if (seg.totalRounds <= 1 || seg.round === 0) return '';
  if (seg.stepIndex !== 0) return '';
  return seg.round === seg.totalRounds ? '最終ラウンド。' : `ラウンド${seg.round}。`;
}

/** 合図を読み上げ文に変換する。読み上げ不要なら null */
export function cueToSpeech(cue: Cue, snap: TimerSnapshot): string | null {
  switch (cue.type) {
    case 'segment': {
      const seg = cue.segment;
      const single = snap.segments.length === 1;
      if (single) return `スタート。${speakDuration(seg.durationMs)}`;
      const head = cue.isFirst ? 'スタート。' : '';
      return `${head}${roundPrefix(seg)}${seg.label}、${speakDuration(seg.durationMs)}`;
    }
    case 'remaining':
      return `残り${speakDuration(cue.remainingMs)}`;
    case 'halfway':
      return '半分経過';
    case 'countdown':
      return String(cue.n);
    case 'finish':
      return snap.segments.length > 1 ? '終了です。お疲れさまでした' : '時間になりました';
  }
}

/** 「残りは？」と聞かれたときの答え */
export function statusSpeech(snap: TimerSnapshot): string {
  if (!snap.segment || snap.totalMs === 0) return 'タイマーが設定されていません';
  if (snap.status === 'finished') return 'タイマーは終了しています';
  const seg = snap.segment;
  const parts: string[] = [];
  if (snap.segments.length > 1) {
    if (seg.totalRounds > 1 && seg.round > 0) parts.push(`ラウンド${seg.round}の${seg.label}`);
    else parts.push(seg.label);
    parts.push(`残り${speakDuration(Math.ceil(snap.segmentRemainingMs / 1000) * 1000)}`);
    if (snap.totalRemainingMs - snap.segmentRemainingMs > 0) {
      parts.push(`全体では残り${speakDuration(Math.ceil(snap.totalRemainingMs / 1000) * 1000)}`);
    }
  } else {
    parts.push(`残り${speakDuration(Math.ceil(snap.segmentRemainingMs / 1000) * 1000)}`);
  }
  if (snap.status === 'paused') parts.push('一時停止中です');
  if (snap.status === 'idle') parts.push('まだ開始していません');
  return parts.join('、');
}
