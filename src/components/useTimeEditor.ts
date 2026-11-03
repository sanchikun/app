import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { expandScale, fitScale, MAX_TOTAL_SEC, snap, snapFor, unwrapDelta } from '../core/dialScale';
import type { StepKind } from '../core/program';

export interface EditorStep {
  label: string;
  kind: StepKind;
  durationSec: number;
}

/** リング版・バー版の設定エディタで共通のプロパティ */
export interface TimeEditorProps {
  mode: 'simple' | 'interval';
  steps: EditorStep[];
  selected: number;
  rounds: number;
  /** 1周（バーなら全幅）に含めるラウンド数（インターバル時） */
  lapRounds: number;
  /** 1周の範囲の表示名（「1回ごと」「全体」など） */
  lapName: string;
  skipLastRest: boolean;
  /** 準備時間を含むプログラム全体の合計（表示用） */
  programTotalSec: number;
  onSelect(index: number): void;
  onChange(index: number, durationSec: number): void;
  onCenterTap(): void;
  onDetent?(): void;
}

export interface Wedge {
  stepIndex: number;
  round: number;
  kind: StepKind;
  startSec: number;
  durationSec: number;
}

/**
 * ポインタ位置を、形（リング / バー）に依存しない値にしたもの。
 * - frac: 時間軸上の位置（リングなら12時から時計回り 0..1、バーなら左端0〜右端1。はみ出すと範囲外の値）
 * - zone: 'track' = 時間を操作する部分 / 'center' = タップで開始する部分 / 'outside' = 何もしない
 */
export interface EditorPoint {
  frac: number;
  zone: 'track' | 'center' | 'outside';
  x: number;
  y: number;
}

interface Options {
  /** リングのように端と端がつながっているか（12時をまたぐドラッグを連続とみなす） */
  wraps: boolean;
  /** ハンドルをつかんだとみなす距離（frac 単位） */
  handleHit: number;
  toPoint(e: ReactPointerEvent): EditorPoint;
}

type Drag =
  | { type: 'handle'; index: number; raw: number; last: number }
  | { type: 'center'; x: number; y: number; moved: boolean }
  | null;

/** 1周ぶんの区間を並べる（Nラウンドぶん。最後のラウンドの休憩省略も反映） */
export function buildWedges(steps: EditorStep[], lapRounds: number, totalRounds: number, skipLastRest: boolean): Wedge[] {
  const n = Math.max(1, lapRounds);
  const includesLast = n >= totalRounds;
  let lastNonRest = steps.length - 1;
  if (includesLast && skipLastRest) while (lastNonRest > 0 && steps[lastNonRest].kind === 'rest') lastNonRest -= 1;
  const wedges: Wedge[] = [];
  let t = 0;
  for (let r = 1; r <= n; r += 1) {
    steps.forEach((s, i) => {
      if (includesLast && skipLastRest && r === n && i > lastNonRest) return;
      wedges.push({ stepIndex: i, round: r, kind: s.kind, startSec: t, durationSec: s.durationSec });
      t += s.durationSec;
    });
  }
  return wedges;
}

/**
 * 設定エディタの状態とドラッグ操作。
 * - タイマー: 目盛り付き（1周/全幅の長さは設定時間に合わせて自動）。タッチした位置の時間になる
 * - インターバル: 「Nラウンド」がちょうど1周/全幅。1ラウンド目の各区間の終わりのハンドルで長さを変えると全ラウンドに反映
 */
export function useTimeEditor(props: TimeEditorProps, opts: Options) {
  const { mode, steps, rounds, lapRounds, skipLastRest, onSelect, onChange, onCenterTap, onDetent } = props;
  const exact = mode === 'interval';
  const minScale = mode === 'simple' ? 300 : 60;
  const roundSec = steps.reduce((a, s) => a + s.durationSec, 0);
  const wedges = mode === 'simple' ? buildWedges(steps, 1, 1, false) : buildWedges(steps, lapRounds, rounds, skipLastRest);
  const lapSec = wedges.reduce((a, w) => a + w.durationSec, 0);

  const [autoScale, setAutoScale] = useState(() => fitScale(roundSec, minScale));
  const [frozen, setFrozen] = useState<number | null>(null);
  const dragging = frozen !== null;
  // ぴったり表示ではドラッグ中は目盛りを固定（ハンドルが指からずれないように）。離すと合わせ直す
  const scale = exact ? (frozen ?? Math.max(lapSec, 1)) : autoScale;

  const dragRef = useRef<Drag>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // ドラッグしていないときは合計時間に合わせて目盛りを合わせ直す
  useEffect(() => {
    if (!dragging) setAutoScale(fitScale(roundSec, minScale));
  }, [roundSec, dragging, minScale]);

  // スナップ幅は「1ラウンドを目盛りで表示したとき」と同じ細かさにする
  const snapStep = snapFor(exact ? fitScale(roundSec, 60) : scale);
  const dist = (a: number, b: number) => (opts.wraps ? Math.abs(unwrapDelta(a, b)) : Math.abs(a - b));

  const minFor = () => (mode === 'simple' ? 0 : 5);
  const maxFor = (index: number) => {
    const others = stepsRef.current.reduce((a, s, i) => (i === index ? a : a + s.durationSec), 0);
    return Math.max(minFor(), MAX_TOTAL_SEC - others);
  };

  const apply = (index: number, raw: number) => {
    const value = Math.min(maxFor(index), Math.max(minFor(), snap(raw, snapStep)));
    const cur = stepsRef.current[index]?.durationSec;
    if (value === cur) return;
    onChange(index, value);
    onDetent?.();
    if (!exact) {
      const total = stepsRef.current.reduce((a, s, i) => a + (i === index ? value : s.durationSec), 0);
      const next = expandScale(scaleRef.current, total);
      if (next !== scaleRef.current) setAutoScale(next);
    }
  };

  const startHandleDrag = (index: number, raw: number, at: number) => {
    dragRef.current = { type: 'handle', index, raw, last: at };
    setFrozen(scaleRef.current);
  };

  const onPointerDown = (e: ReactPointerEvent<Element>) => {
    const p = opts.toPoint(e);
    if (p.zone === 'center') {
      dragRef.current = { type: 'center', x: p.x, y: p.y, moved: false };
      return;
    }
    if (p.zone === 'outside') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const sc = scaleRef.current;

    // 一番近いハンドル（1ラウンド目のみ編集できる）
    let nearest: Wedge | null = null;
    let nearestDist = Infinity;
    for (const w of wedges) {
      if (w.round !== 1) continue;
      const d = dist(p.frac, Math.min(1, (w.startSec + w.durationSec) / sc));
      if (d < nearestDist) {
        nearestDist = d;
        nearest = w;
      }
    }

    if (mode === 'simple') {
      // ハンドル付近なら今の値から、それ以外はタッチした位置の値にする
      const raw = nearestDist < opts.handleHit ? steps[0].durationSec : p.frac * sc;
      startHandleDrag(0, raw, p.frac);
      apply(0, raw);
      return;
    }

    if (nearest && nearestDist < opts.handleHit) {
      onSelect(nearest.stepIndex);
      startHandleDrag(nearest.stepIndex, steps[nearest.stepIndex].durationSec, p.frac);
      return;
    }
    const posSec = p.frac * sc;
    const hit = wedges.find((w) => posSec >= w.startSec && posSec < w.startSec + w.durationSec);
    onSelect(hit ? hit.stepIndex : steps.length - 1);
    dragRef.current = null;
  };

  const onPointerMove = (e: ReactPointerEvent<Element>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = opts.toPoint(e);
    if (d.type === 'center') {
      if (Math.hypot(p.x - d.x, p.y - d.y) > 8) d.moved = true;
      return;
    }
    const delta = opts.wraps ? unwrapDelta(d.last, p.frac) : p.frac - d.last;
    d.last = p.frac;
    d.raw = Math.min(maxFor(d.index) + 30, Math.max(minFor() - 30, d.raw + delta * scaleRef.current));
    apply(d.index, d.raw);
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setFrozen(null);
    if (d?.type === 'center' && !d.moved) onCenterTap();
  };

  const sel = steps[Math.min(props.selected, steps.length - 1)];

  return {
    exact,
    wedges,
    scale,
    lapSec,
    dragging,
    sel,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
