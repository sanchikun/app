import { buildSegments, totalDurationMs, type Program, type Segment } from './program';

export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface TimerSnapshot {
  status: TimerStatus;
  /** 全体の経過ms */
  elapsedMs: number;
  totalMs: number;
  totalRemainingMs: number;
  segments: Segment[];
  /** 現在の区間（区間が無いプログラムなら null） */
  segment: Segment | null;
  segmentElapsedMs: number;
  segmentRemainingMs: number;
  /** 現在区間の進捗 0..1（リングの1周に対応） */
  segmentProgress: number;
  /** 全体の進捗 0..1 */
  totalProgress: number;
}

export type Clock = () => number;

const defaultClock: Clock = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/**
 * 経過時間ベースのタイマーエンジン。
 *
 * setInterval のティック数を数えるのではなく「開始時刻からの経過」で状態を計算するので、
 * タブがバックグラウンドで間引かれても時間がずれない。
 * スマホアプリ化した際も「終了予定時刻」を基準に復帰・通知予約ができる。
 */
export class TimerEngine {
  private program: Program;
  private segments: Segment[];
  private totalMs: number;
  private status: TimerStatus = 'idle';
  /** 一時停止までに積み上がった経過ms */
  private accumulatedMs = 0;
  /** running になった時刻（clock基準） */
  private resumedAt = 0;
  private readonly clock: Clock;

  constructor(program: Program, clock: Clock = defaultClock) {
    this.clock = clock;
    this.program = program;
    this.segments = buildSegments(program);
    this.totalMs = totalDurationMs(this.segments);
  }

  getProgram(): Program {
    return this.program;
  }

  /** プログラムを差し替えて初期状態に戻す */
  load(program: Program): void {
    this.program = program;
    this.segments = buildSegments(program);
    this.totalMs = totalDurationMs(this.segments);
    this.reset();
  }

  start(): void {
    if (this.totalMs <= 0) return;
    if (this.status === 'running') return;
    if (this.status === 'finished') this.accumulatedMs = 0;
    this.status = 'running';
    this.resumedAt = this.clock();
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.accumulatedMs = this.rawElapsed();
    this.status = 'paused';
  }

  /** 再生中なら一時停止、それ以外なら開始/再開 */
  toggle(): void {
    if (this.status === 'running') this.pause();
    else this.start();
  }

  reset(): void {
    this.status = 'idle';
    this.accumulatedMs = 0;
    this.resumedAt = 0;
  }

  /** 現在の区間を飛ばして次の区間の先頭へ */
  skip(): void {
    const snap = this.getSnapshot();
    if (!snap.segment || snap.status === 'finished') return;
    this.setElapsed(snap.segment.startMs + snap.segment.durationMs);
  }

  /** 現在の区間の先頭に戻る（区間の最初1.5秒以内なら前の区間へ） */
  previous(): void {
    const snap = this.getSnapshot();
    if (!snap.segment) return;
    const seg = snap.segment;
    if (snap.segmentElapsedMs < 1500 && seg.index > 0) {
      this.setElapsed(this.segments[seg.index - 1].startMs);
    } else {
      this.setElapsed(seg.startMs);
    }
  }

  /** 現在区間の長さを延長（負数で短縮）する。以降の区間は後ろにずれる */
  addTime(deltaMs: number): void {
    const snap = this.getSnapshot();
    const seg = snap.status === 'finished' ? this.segments[this.segments.length - 1] : snap.segment;
    if (!seg) return;
    // 短縮は「残り0」より手前まで
    const minDuration = snap.segmentElapsedMs + (snap.status === 'finished' ? 0 : 1);
    const newDuration = Math.max(minDuration, seg.durationMs + deltaMs);
    const diff = newDuration - seg.durationMs;
    if (diff === 0) return;
    this.segments = this.segments.map((s) => {
      if (s.index === seg.index) return { ...s, durationMs: newDuration };
      if (s.index > seg.index) return { ...s, startMs: s.startMs + diff };
      return s;
    });
    this.totalMs += diff;
    if (this.status === 'finished') {
      // 終了後に延長した場合は、その場で再開する
      this.accumulatedMs = this.rawElapsed();
      this.status = 'running';
      this.resumedAt = this.clock();
    }
  }

  getSnapshot(): TimerSnapshot {
    let elapsed = this.rawElapsed();
    if (elapsed >= this.totalMs && this.status === 'running') {
      // 走っている間に終端に達したら finished に遷移
      this.status = 'finished';
      this.accumulatedMs = this.totalMs;
      elapsed = this.totalMs;
    }
    elapsed = Math.min(Math.max(0, elapsed), this.totalMs);

    const segment = this.findSegment(elapsed);
    const segmentElapsedMs = segment ? elapsed - segment.startMs : 0;
    const segmentRemainingMs = segment ? segment.durationMs - segmentElapsedMs : 0;
    return {
      status: this.status,
      elapsedMs: elapsed,
      totalMs: this.totalMs,
      totalRemainingMs: this.totalMs - elapsed,
      segments: this.segments,
      segment,
      segmentElapsedMs,
      segmentRemainingMs,
      segmentProgress: segment && segment.durationMs > 0 ? segmentElapsedMs / segment.durationMs : 0,
      totalProgress: this.totalMs > 0 ? elapsed / this.totalMs : 0,
    };
  }

  private rawElapsed(): number {
    if (this.status === 'running') return this.accumulatedMs + (this.clock() - this.resumedAt);
    return this.accumulatedMs;
  }

  private setElapsed(ms: number): void {
    const clamped = Math.min(Math.max(0, ms), this.totalMs);
    this.accumulatedMs = clamped;
    if (this.status === 'running') this.resumedAt = this.clock();
    if (clamped >= this.totalMs) {
      this.status = 'finished';
    } else if (this.status === 'finished') {
      this.status = 'paused';
    }
  }

  private findSegment(elapsed: number): Segment | null {
    if (this.segments.length === 0) return null;
    // 終端ちょうどは最後の区間（残り0）として扱う
    for (const s of this.segments) {
      if (elapsed < s.startMs + s.durationMs) return s;
    }
    return this.segments[this.segments.length - 1];
  }
}
