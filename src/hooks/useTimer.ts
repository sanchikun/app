import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectCues, type AnnounceSettings, type Cue } from '../core/announcer';
import { TimerEngine, type TimerSnapshot } from '../core/engine';
import type { Program } from '../core/program';

export interface TimerActions {
  start(): void;
  pause(): void;
  toggle(): void;
  reset(): void;
  skip(): void;
  previous(): void;
  addTime(sec: number): void;
  load(program: Program): void;
  /** 現在の最新スナップショット（イベントハンドラ内で使う） */
  current(): TimerSnapshot;
}

/**
 * TimerEngine を React から使うためのフック。
 * - 動作中は requestAnimationFrame で滑らかに描画
 * - タブが裏に回って rAF が止まっても、setInterval で合図（読み上げ）は出し続ける
 */
export function useTimer(
  initial: Program,
  announce: AnnounceSettings,
  onCues: (cues: Cue[], snap: TimerSnapshot) => void,
): [TimerSnapshot, TimerActions] {
  const engineRef = useRef<TimerEngine | null>(null);
  if (!engineRef.current) engineRef.current = new TimerEngine(initial);
  const engine = engineRef.current;

  const [snap, setSnap] = useState<TimerSnapshot>(() => engine.getSnapshot());
  const prevRef = useRef<TimerSnapshot | null>(snap);
  const announceRef = useRef(announce);
  const onCuesRef = useRef(onCues);
  announceRef.current = announce;
  onCuesRef.current = onCues;

  const update = useCallback(() => {
    const next = engine.getSnapshot();
    const cues = detectCues(prevRef.current, next, announceRef.current);
    prevRef.current = next;
    if (cues.length) onCuesRef.current(cues, next);
    setSnap(next);
    return next;
  }, [engine]);

  const running = snap.status === 'running';
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const loop = () => {
      const s = update();
      if (s.status === 'running') raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const iv = setInterval(update, 200);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(iv);
    };
  }, [running, update]);

  const actions = useMemo<TimerActions>(
    () => ({
      start: () => {
        engine.start();
        update();
      },
      pause: () => {
        engine.pause();
        update();
      },
      toggle: () => {
        engine.toggle();
        update();
      },
      reset: () => {
        engine.reset();
        update();
      },
      skip: () => {
        engine.skip();
        update();
      },
      previous: () => {
        engine.previous();
        update();
      },
      addTime: (sec: number) => {
        engine.addTime(sec * 1000);
        update();
      },
      load: (program: Program) => {
        engine.load(program);
        update();
      },
      current: () => engine.getSnapshot(),
    }),
    [engine, update],
  );

  return [snap, actions];
}
