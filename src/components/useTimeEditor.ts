import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { expandScale, fitScale, MAX_TOTAL_SEC, snap, snapFor, unwrapDelta } from '../core/dialScale';
import type { StepKind } from '../core/program';
import { resizePair, unitFor } from '../core/split';

export interface EditorStep {
  label: string;
  kind: StepKind;
  durationSec: number;
}

/** リング版・バー版の設定エディタで共通のプロパティ */
export interface TimeEditorProps {
  mode: 'simple' | 'interval';
  /** 1サイクル分の区間 */
  steps: EditorStep[];
  selected: number;
  /** 繰り返し回数（インターバル時。全体 = 1サイクル × rounds） */
  rounds: number;
  onSelect(index: number): void;
  /** タイマー: 時間を変える */
  onChange(index: number, durationSec: number): void;
  /** インターバル: 境目を動かして配分を変える（合計は同じ） */
  onDurations(durations: number[]): void;
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

/** つまみ。インターバルでは区間の境目、タイマーでは終わりの位置 */
export interface Handle {
  key: string;
  /** 位置（全体=1） */
  frac: number;
  /** つまみの縁の色に使う区間の種類（境目の左側） */
  kind: StepKind;
  active: boolean;
  /** 境目の左右の区間（1サイクル内の index）。左 a を伸ばすと右 b が縮む */
  a: number;
  b: number;
  /** 画面に描くか（1サイクル目だけ描き、他のサイクルの境目は見えないつかみ所にする） */
  visible: boolean;
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
  /** つまみをつかんだとみなす距離（frac 単位） */
  handleHit: number;
  toPoint(e: ReactPointerEvent): EditorPoint;
}

type Drag =
  | { type: 'end'; raw: number; last: number }
  | { type: 'boundary'; a: number; b: number; raw: number; last: number }
  | { type: 'center'; x: number; y: number; moved: boolean }
  | null;

/** 全体（rounds サイクル分）の区間を並べる */
export function buildWedges(steps: EditorStep[], rounds: number): Wedge[] {
  const wedges: Wedge[] = [];
  let t = 0;
  for (let r = 1; r <= Math.max(1, rounds); r += 1) {
    steps.forEach((s, i) => {
      wedges.push({ stepIndex: i, round: r, kind: s.kind, startSec: t, durationSec: s.durationSec });
      t += s.durationSec;
    });
  }
  return wedges;
}

/**
 * 設定エディタの状態とドラッグ操作。
 * - タイマー: 目盛り付き（全体の長さは設定時間に合わせて自動）。タッチした位置の時間になる
 * - インターバル: 円/バー全体＝プログラム全体。1サイクル目の区間の境目にあるつまみを動かすと、
 *   合計はそのままでワーク・休憩の配分（割合）が変わり、全サイクルに反映される
 */
export function useTimeEditor(props: TimeEditorProps, opts: Options) {
  const { mode, steps, rounds, selected, onSelect, onChange, onDurations, onCenterTap, onDetent } = props;
  const simple = mode === 'simple';
  const cycleSec = steps.reduce((a, s) => a + s.durationSec, 0);
  const wedges = simple ? buildWedges(steps, 1) : buildWedges(steps, rounds);
  const totalSec = wedges.reduce((a, w) => a + w.durationSec, 0);

  const [autoScale, setAutoScale] = useState(() => fitScale(cycleSec, 300));
  const [dragging, setDragging] = useState(false);
  const scale = simple ? autoScale : Math.max(totalSec, 1);

  const dragRef = useRef<Drag>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // タイマー: ドラッグしていないときは設定時間に合わせて目盛りを合わせ直す
  useEffect(() => {
    if (simple && !dragging) setAutoScale(fitScale(cycleSec, 300));
  }, [simple, cycleSec, dragging]);

  const dist = (a: number, b: number) => (opts.wraps ? Math.abs(unwrapDelta(a, b)) : Math.abs(a - b));
  const durations = () => stepsRef.current.map((s) => s.durationSec);

  // つまみ: 各サイクル内の区間の境目。どのサイクルの境目をつかんでも同じ配分が変わる
  // （サイクルの切れ目は「1サイクルの長さ × 回数」で位置が決まっているので動かせない）
  const handles: Handle[] = simple
    ? [{ key: 'end', frac: Math.min(1, cycleSec / scale), kind: steps[0]?.kind ?? 'work', active: true, a: 0, b: 0, visible: true }]
    : wedges
        .filter((w) => w.stepIndex > 0)
        .map((w) => {
          const a = w.stepIndex - 1;
          const b = w.stepIndex;
          // 描くのは1サイクル目だけ。他のサイクルの境目は見えないつかみ所
          const visible = w.round === 1;
          return {
            key: `b${w.round}-${w.stepIndex}`,
            frac: w.startSec / scale,
            kind: steps[a].kind,
            active: visible && (a === selected || b === selected),
            a,
            b,
            visible,
          };
        });

  // ---- タイマー（終わりの位置を決める） ----
  const applyEnd = (raw: number) => {
    const sc = scaleRef.current;
    const value = Math.min(MAX_TOTAL_SEC, Math.max(0, snap(raw, snapFor(sc))));
    if (value === stepsRef.current[0]?.durationSec) return;
    onChange(0, value);
    onDetent?.();
    const next = expandScale(sc, value);
    if (next !== sc) setAutoScale(next);
  };

  // ---- インターバル（境目を動かす: 左の区間 a の長さを raw にし、右の区間 b で調整） ----
  const applyBoundary = (a: number, b: number, raw: number) => {
    const cur = durations();
    const next = resizePair(cur, a, b, raw, unitFor(cur.reduce((x, y) => x + y, 0)));
    if (next === cur) return;
    onDurations(next);
    onDetent?.();
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

    if (simple) {
      // つまみ付近なら今の値から、それ以外はタッチした位置の値にする
      const near = dist(p.frac, handles[0].frac) < opts.handleHit;
      const raw = near ? steps[0].durationSec : p.frac * sc;
      dragRef.current = { type: 'end', raw, last: p.frac };
      setDragging(true);
      applyEnd(raw);
      return;
    }

    // 一番近い境目のつまみ
    let nearest = -1;
    let nearestDist = Infinity;
    handles.forEach((h, i) => {
      const d = dist(p.frac, h.frac);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    });
    if (nearest >= 0 && nearestDist < opts.handleHit) {
      const h = handles[nearest];
      // 境目の左右どちらかの区間を選択状態に（今選んでいる方を優先）
      if (selected !== h.a && selected !== h.b) onSelect(h.a);
      dragRef.current = { type: 'boundary', a: h.a, b: h.b, raw: steps[h.a].durationSec, last: p.frac };
      setDragging(true);
      return;
    }
    // それ以外はタップした区間を選択
    const posSec = (((p.frac % 1) + 1) % 1) * sc;
    const hit = wedges.find((w) => posSec >= w.startSec && posSec < w.startSec + w.durationSec);
    if (hit) onSelect(hit.stepIndex);
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
    d.raw += delta * scaleRef.current;
    if (d.type === 'end') {
      d.raw = Math.min(MAX_TOTAL_SEC + 30, Math.max(-30, d.raw));
      applyEnd(d.raw);
    } else {
      applyBoundary(d.a, d.b, d.raw);
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (d?.type === 'center' && !d.moved) onCenterTap();
  };

  const sel = steps[Math.min(selected, steps.length - 1)];

  return {
    simple,
    wedges,
    handles,
    scale,
    totalSec,
    dragging,
    sel,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
