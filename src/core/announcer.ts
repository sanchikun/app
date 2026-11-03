import type { TimerSnapshot } from './engine';
import type { Segment } from './program';

/** 読み上げ・効果音のきっかけとなるイベント */
export type Cue =
  | { type: 'segment'; segment: Segment; isFirst: boolean }
  | { type: 'remaining'; remainingMs: number; segment: Segment }
  | { type: 'halfway'; segment: Segment }
  | { type: 'countdown'; n: number; segment: Segment }
  | { type: 'finish' };

export interface AnnounceSettings {
  /** 区間の開始（ワーク/休憩の切り替わり）を知らせる */
  segmentStart: boolean;
  /** 区間の半分経過を知らせる */
  halfway: boolean;
  /** 残り時間を毎分知らせる */
  everyMinute: boolean;
  /** 残り1分を知らせる */
  lastMinute: boolean;
  /** 残り30秒を知らせる */
  last30: boolean;
  /** 残り10秒を知らせる */
  last10: boolean;
  /** 最後の n 秒をカウントダウンする（0 で無効） */
  countdown: number;
}

export const defaultAnnounceSettings: AnnounceSettings = {
  segmentStart: true,
  halfway: false,
  everyMinute: false,
  lastMinute: true,
  last30: true,
  last10: true,
  countdown: 3,
};

/** これ以上の時間が一度に飛んだら（バックグラウンド復帰など）残り時間系の通知は捨てる */
const STALE_GAP_MS = 2000;

const crossed = (prevRemaining: number, curRemaining: number, threshold: number) =>
  prevRemaining > threshold && curRemaining <= threshold;

/**
 * 前回と今回のスナップショットを比較して、発火すべき合図を返す。
 * 純粋関数なので UI やブラウザ API に依存せずテストできる。
 */
export function detectCues(
  prev: TimerSnapshot | null,
  cur: TimerSnapshot,
  settings: AnnounceSettings,
): Cue[] {
  const cues: Cue[] = [];
  if (!cur.segment) return cues;

  const wasRunning = prev?.status === 'running';

  // 終了
  if (cur.status === 'finished') {
    if (wasRunning) cues.push({ type: 'finish' });
    return cues;
  }
  if (cur.status !== 'running') return cues;

  // 開始（idle/finished → running で経過0付近）
  if (!prev || prev.status === 'idle' || prev.status === 'finished') {
    if (cur.elapsedMs < 1000) cues.push({ type: 'segment', segment: cur.segment, isFirst: true });
    return cues;
  }
  // 一時停止からの再開時は何も言わない（UI 側で「再開」を読み上げる）
  if (!wasRunning) return cues;

  // 区間の切り替わり
  if (prev.segment && prev.segment.index !== cur.segment.index) {
    if (settings.segmentStart) cues.push({ type: 'segment', segment: cur.segment, isFirst: false });
    return cues;
  }

  // ここからは同じ区間内での残り時間系
  if (cur.elapsedMs - prev.elapsedMs > STALE_GAP_MS || cur.elapsedMs < prev.elapsedMs) return cues;

  const seg = cur.segment;
  const pr = prev.segmentRemainingMs;
  const cr = cur.segmentRemainingMs;
  // 区間の長さが閾値より十分長いときだけ知らせる（30秒の区間で開始直後に「残り30秒」と言わない）
  const longEnough = (threshold: number, margin: number) => seg.durationMs >= threshold + margin;

  for (let n = Math.min(settings.countdown, 10); n >= 1; n -= 1) {
    const t = n * 1000;
    if (crossed(pr, cr, t) && longEnough(t, 1000)) {
      cues.push({ type: 'countdown', n, segment: seg });
      return cues;
    }
  }

  const thresholds: number[] = [];
  if (settings.last10) thresholds.push(10_000);
  if (settings.last30) thresholds.push(30_000);
  if (settings.lastMinute || settings.everyMinute) thresholds.push(60_000);
  if (settings.everyMinute) {
    for (let m = 2; m * 60_000 < seg.durationMs; m += 1) thresholds.push(m * 60_000);
  }
  for (const t of thresholds) {
    if (crossed(pr, cr, t) && longEnough(t, 5000)) {
      cues.push({ type: 'remaining', remainingMs: t, segment: seg });
      return cues;
    }
  }

  if (settings.halfway && seg.durationMs >= 20_000) {
    const half = seg.durationMs / 2;
    if (crossed(pr, cr, half)) cues.push({ type: 'halfway', segment: seg });
  }
  return cues;
}
