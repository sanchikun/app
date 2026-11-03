import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { angleFrac, expandScale, fitScale, MAX_TOTAL_SEC, scaleLabel, snap, snapFor, unwrapDelta } from '../core/dialScale';
import { formatClock } from '../core/format';
import type { StepKind } from '../core/program';
import type { DialStyle } from '../services/storage';
import { kindColor } from './Dial';
import { arcPath, C, polar, R_MAIN, sectorPath, SIZE, STROKE } from './dialGeometry';

export interface EditorStep {
  label: string;
  kind: StepKind;
  durationSec: number;
}

interface Props {
  mode: 'simple' | 'interval';
  steps: EditorStep[];
  selected: number;
  rounds: number;
  /**
   * 1周に含めるラウンド数。0 なら「区間ごと」で、ダイヤルは1ラウンド分を目盛り付きで表示する。
   * 1以上なら、そのラウンド数ぶんの区間でちょうど1周するように表示する。
   */
  lapRounds: number;
  /** 1周の範囲の表示名（「全体」「1回ごと」など） */
  lapName: string;
  skipLastRest: boolean;
  /** 準備時間を含むプログラム全体の合計（中央に表示） */
  programTotalSec: number;
  style: DialStyle;
  onSelect(index: number): void;
  onChange(index: number, durationSec: number): void;
  onCenterTap(): void;
  onDetent?(): void;
}

interface Wedge {
  stepIndex: number;
  round: number;
  kind: StepKind;
  startSec: number;
  durationSec: number;
}

type Drag =
  | { type: 'handle'; index: number; raw: number; lastA: number }
  | { type: 'center'; x: number; y: number; moved: boolean }
  | null;

/** ハンドルをつかんだとみなす角度の幅（1周=1） */
const HANDLE_HIT = 0.05;

/** 1周ぶんの扇形を並べる（Nラウンドぶん。最後のラウンドの休憩省略も反映） */
function buildWedges(steps: EditorStep[], lapRounds: number, totalRounds: number, skipLastRest: boolean): Wedge[] {
  const n = Math.max(1, lapRounds);
  const includesLast = lapRounds > 0 && n >= totalRounds;
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
 * 設定用の円グラフ。
 * - タイマー: 円をなぞる／ハンドルを回すと時間が決まる（キッチンタイマーの要領）。1周の長さは自動で切替
 * - インターバル（1周＝全体 / Nラウンド）: その範囲でちょうど1周。繰り返し部分も扇形で並ぶ。
 *   1ラウンド目の各扇形の終わりにあるハンドルを回すと、その区間の長さが全ラウンドで変わる
 * - インターバル（1周＝区間ごと）: 1ラウンドを目盛り付きのダイヤルで表示
 */
export function DialEditor({
  mode,
  steps,
  selected,
  rounds,
  lapRounds,
  lapName,
  skipLastRest,
  programTotalSec,
  style,
  onSelect,
  onChange,
  onCenterTap,
  onDetent,
}: Props) {
  const exact = mode === 'interval' && lapRounds > 0;
  const minScale = mode === 'simple' ? 300 : 60;
  const roundSec = steps.reduce((a, s) => a + s.durationSec, 0);
  const wedges = mode === 'simple' ? buildWedges(steps, 1, 1, false) : buildWedges(steps, lapRounds, rounds, skipLastRest);
  const lapSec = wedges.reduce((a, w) => a + w.durationSec, 0);

  const [autoScale, setAutoScale] = useState(() => fitScale(roundSec, minScale));
  const [frozen, setFrozen] = useState<number | null>(null);
  const dragging = frozen !== null;
  // 1周表示ではドラッグ中は目盛りを固定（ハンドルが指からずれないように）。離すと1周に合わせ直す
  const scale = exact ? (frozen ?? Math.max(lapSec, 1)) : autoScale;

  const svgRef = useRef<SVGSVGElement>(null);
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

  const toLocal = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * SIZE;
    return { x, y, r: Math.hypot(x - C, y - C), a: angleFrac(C, C, x, y) };
  };

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

  const startHandleDrag = (index: number, raw: number, a: number) => {
    dragRef.current = { type: 'handle', index, raw, lastA: a };
    setFrozen(scaleRef.current);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toLocal(e);
    if (p.r < R_MAIN - STROKE / 2 - 10) {
      dragRef.current = { type: 'center', x: p.x, y: p.y, moved: false };
      return;
    }
    if (p.r > R_MAIN + STROKE / 2 + 30) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const sc = scaleRef.current;

    // 一番近いハンドル（1ラウンド目のみ編集できる）
    let nearest: Wedge | null = null;
    let nearestDist = Infinity;
    for (const w of wedges) {
      if (w.round !== 1) continue;
      const d = Math.abs(unwrapDelta(p.a, Math.min(1, (w.startSec + w.durationSec) / sc)));
      if (d < nearestDist) {
        nearestDist = d;
        nearest = w;
      }
    }

    if (mode === 'simple') {
      // ハンドル付近なら今の値から、それ以外はタッチした位置の値にする
      const raw = nearestDist < HANDLE_HIT ? steps[0].durationSec : p.a * sc;
      startHandleDrag(0, raw, p.a);
      apply(0, raw);
      return;
    }

    if (nearest && nearestDist < HANDLE_HIT) {
      onSelect(nearest.stepIndex);
      startHandleDrag(nearest.stepIndex, steps[nearest.stepIndex].durationSec, p.a);
      return;
    }
    const posSec = p.a * sc;
    const hit = wedges.find((w) => posSec >= w.startSec && posSec < w.startSec + w.durationSec);
    if (hit) {
      onSelect(hit.stepIndex);
      dragRef.current = null;
      return;
    }
    // 扇形の外側（目盛り表示で余っている部分）→ 最後の区間をそこまで伸ばす
    const last = steps.length - 1;
    onSelect(last);
    if (!exact) {
      const raw = posSec - (roundSec - steps[last].durationSec);
      startHandleDrag(last, raw, p.a);
      apply(last, raw);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toLocal(e);
    if (d.type === 'center') {
      if (Math.hypot(p.x - d.x, p.y - d.y) > 8) d.moved = true;
      return;
    }
    const delta = unwrapDelta(d.lastA, p.a);
    d.lastA = p.a;
    d.raw = Math.min(maxFor(d.index) + 30, Math.max(minFor() - 30, d.raw + delta * scaleRef.current));
    apply(d.index, d.raw);
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setFrozen(null);
    if (d?.type === 'center' && !d.moved) onCenterTap();
  };

  const sel = steps[Math.min(selected, steps.length - 1)];
  const selColor = kindColor(sel?.kind);
  const isPie = style === 'pie';
  const R_PIE = R_MAIN + STROKE / 2;

  return (
    <div className={`dial editor style-${style} ${dragging ? 'dragging' : ''}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="dial-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-label="ダイヤルを回して時間を設定"
        aria-valuemin={0}
        aria-valuemax={MAX_TOTAL_SEC}
        aria-valuenow={sel?.durationSec ?? 0}
        aria-valuetext={formatClock((sel?.durationSec ?? 0) * 1000)}
      >
        {isPie ? (
          <circle cx={C} cy={C} r={R_PIE} className="pie-bg" />
        ) : (
          <circle cx={C} cy={C} r={R_MAIN} className="track" strokeWidth={STROKE} />
        )}

        {/* 扇形（各区間。2ラウンド目以降は少し淡く） */}
        {wedges.map((w, i) => {
          if (w.durationSec <= 0) return null;
          const from = w.startSec / scale;
          const to = Math.min(1, (w.startSec + w.durationSec) / scale);
          if (to <= from) return null;
          const isSel = mode === 'simple' || w.stepIndex === selected;
          const opacity = (isSel ? 1 : 0.45) * (w.round === 1 ? 1 : 0.7);
          return isPie ? (
            <path key={i} d={sectorPath(R_PIE, from, to)} fill={kindColor(w.kind)} opacity={opacity} />
          ) : (
            <path key={i} d={arcPath(R_MAIN, from, to)} stroke={kindColor(w.kind)} strokeWidth={STROKE} fill="none" opacity={opacity} />
          );
        })}
        {isPie && <circle cx={C} cy={C} r={R_MAIN - STROKE - 6} className="pie-hole" />}

        {/* 目盛り（目盛り表示のときのみ。1/4・1/2・3/4 にラベル） */}
        {!exact &&
          Array.from({ length: 12 }, (_, i) => {
            const r0 = isPie ? R_MAIN - STROKE - 10 : R_MAIN - STROKE / 2 - 5;
            const [x1, y1] = polar(r0, i / 12);
            const [x2, y2] = polar(r0 - (i % 3 === 0 ? 8 : 4), i / 12);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="minor-tick" />;
          })}
        {!exact &&
          [0.25, 0.5, 0.75].map((f) => {
            const [x, y] = polar(isPie ? R_MAIN - STROKE - 28 : R_MAIN - STROKE / 2 - 22, f);
            return (
              <text key={f} x={x} y={y} className="scale-label" textAnchor="middle" dominantBaseline="central">
                {scaleLabel(scale * f, scale)}
              </text>
            );
          })}

        {/* 区切り線（ラウンドの境目は太め） */}
        {mode === 'interval' &&
          wedges.map((w, i) => {
            const f = w.startSec / scale;
            if (f >= 1) return null;
            const [x1, y1] = polar(isPie ? R_MAIN - STROKE - 6 : R_MAIN - STROKE / 2 - 1, f);
            const [x2, y2] = polar(R_MAIN + STROKE / 2 + 1, f);
            return (
              <line
                key={`sep${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className={`separator ${w.stepIndex === 0 && i > 0 ? 'round-edge' : ''}`}
              />
            );
          })}

        {/* ハンドル（1ラウンド目の各区間の終わり） */}
        {wedges.map((w, i) => {
          if (w.round !== 1) return null;
          const end = Math.min(1, (w.startSec + w.durationSec) / scale);
          const [x, y] = polar(R_MAIN, end);
          const active = mode === 'simple' || w.stepIndex === selected;
          return (
            <g key={`h${i}`} className={`handle ${active ? 'active' : ''}`}>
              <circle cx={x} cy={y} r={active ? 15 : 11} className="handle-dot" stroke={kindColor(w.kind)} />
            </g>
          );
        })}
      </svg>

      <div className="dial-center">
        {mode === 'interval' ? (
          <>
            <div className="dial-label" style={{ color: selColor }}>
              {sel?.label}
            </div>
            <div className="dial-time">{formatClock((sel?.durationSec ?? 0) * 1000)}</div>
            <div className="dial-sub">
              ×{rounds} ・ 合計 {formatClock(programTotalSec * 1000)}
            </div>
            <div className="dial-sub dim">
              1周 = {lapName}
              {exact && lapRounds < rounds ? `（${formatClock(lapSec * 1000)}）` : ''}
            </div>
          </>
        ) : (
          <>
            <div className="dial-label" style={{ color: selColor }}>
              タイマー
            </div>
            <div className="dial-time">{formatClock((sel?.durationSec ?? 0) * 1000)}</div>
            <div className="dial-sub dim">
              {(sel?.durationSec ?? 0) > 0 ? 'タップでスタート' : '円をなぞって時間を設定'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
