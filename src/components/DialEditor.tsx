import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  angleFrac,
  expandScale,
  fitScale,
  MAX_TOTAL_SEC,
  scaleLabel,
  snap,
  snapFor,
  unwrapDelta,
} from '../core/dialScale';
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
  /** 準備時間を含むプログラム全体の合計（中央に表示） */
  programTotalSec: number;
  style: DialStyle;
  onSelect(index: number): void;
  onChange(index: number, durationSec: number): void;
  onCenterTap(): void;
  onDetent?(): void;
}

type Drag =
  | { type: 'handle'; index: number; raw: number; lastA: number }
  | { type: 'center'; x: number; y: number; moved: boolean }
  | null;

/** ハンドルをつかんだとみなす角度の幅（1周=1） */
const HANDLE_HIT = 0.05;

/**
 * 設定用の円グラフ。
 * - タイマー: 円をなぞる／ハンドルを回すと時間が決まる（キッチンタイマーの要領）
 * - インターバル: 1ラウンドを扇形で表示。各扇形の終わりのハンドルを回すとその区間の長さが変わる。
 *   扇形をタップするとその区間を選択（下の −/＋ で微調整）。
 * 1周が何分にあたるかは設定時間に合わせて自動で切り替わる。
 */
export function DialEditor({
  mode,
  steps,
  selected,
  rounds,
  programTotalSec,
  style,
  onSelect,
  onChange,
  onCenterTap,
  onDetent,
}: Props) {
  const minScale = mode === 'simple' ? 300 : 60;
  const roundSec = steps.reduce((a, s) => a + s.durationSec, 0);
  const [scale, setScale] = useState(() => fitScale(roundSec, minScale));
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // ドラッグしていないときは合計時間に合わせて目盛りを合わせ直す
  useEffect(() => {
    if (!dragging) setScale(fitScale(roundSec, minScale));
  }, [roundSec, dragging, minScale]);

  const starts: number[] = [];
  steps.reduce((acc, s) => {
    starts.push(acc);
    return acc + s.durationSec;
  }, 0);

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
    const sc = scaleRef.current;
    const value = Math.min(maxFor(index), Math.max(minFor(), snap(raw, snapFor(sc))));
    const cur = stepsRef.current[index]?.durationSec;
    if (value !== cur) {
      onChange(index, value);
      onDetent?.();
      const total = stepsRef.current.reduce((a, s, i) => a + (i === index ? value : s.durationSec), 0);
      const next = expandScale(sc, total);
      if (next !== sc) setScale(next);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toLocal(e);
    const inner = R_MAIN - STROKE / 2 - 10;
    if (p.r < inner) {
      dragRef.current = { type: 'center', x: p.x, y: p.y, moved: false };
      return;
    }
    if (p.r > R_MAIN + STROKE / 2 + 30) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const sc = scaleRef.current;

    // 一番近いハンドル
    let nearest = -1;
    let nearestDist = Infinity;
    steps.forEach((s, i) => {
      const end = (starts[i] + s.durationSec) / sc;
      const d = Math.abs(unwrapDelta(p.a, end));
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    });

    if (mode === 'simple') {
      // ハンドル付近なら今の値から、それ以外はタッチした位置の値にする
      const raw = nearestDist < HANDLE_HIT ? steps[0].durationSec : p.a * sc;
      dragRef.current = { type: 'handle', index: 0, raw, lastA: p.a };
      setDragging(true);
      apply(0, raw);
      return;
    }

    if (nearest >= 0 && nearestDist < HANDLE_HIT) {
      onSelect(nearest);
      dragRef.current = { type: 'handle', index: nearest, raw: steps[nearest].durationSec, lastA: p.a };
      setDragging(true);
      return;
    }
    const posSec = p.a * sc;
    const hit = steps.findIndex((s, i) => posSec >= starts[i] && posSec < starts[i] + s.durationSec);
    if (hit >= 0) {
      onSelect(hit);
      dragRef.current = null;
      return;
    }
    // 最後の扇形より先をタッチ → 最後の区間をそこまで伸ばす
    const last = steps.length - 1;
    onSelect(last);
    const raw = posSec - starts[last];
    dragRef.current = { type: 'handle', index: last, raw, lastA: p.a };
    setDragging(true);
    apply(last, raw);
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
    setDragging(false);
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

        {/* 扇形（各ステップ） */}
        {steps.map((s, i) => {
          if (s.durationSec <= 0) return null;
          const from = starts[i] / scale;
          const to = Math.min(1, (starts[i] + s.durationSec) / scale);
          const dim = mode === 'interval' && i !== selected;
          return isPie ? (
            <path key={i} d={sectorPath(R_PIE, from, to)} fill={kindColor(s.kind)} opacity={dim ? 0.45 : 1} />
          ) : (
            <path
              key={i}
              d={arcPath(R_MAIN, from, to)}
              stroke={kindColor(s.kind)}
              strokeWidth={STROKE}
              fill="none"
              opacity={dim ? 0.45 : 1}
            />
          );
        })}
        {isPie && <circle cx={C} cy={C} r={R_MAIN - STROKE - 6} className="pie-hole" />}

        {/* 目盛り（ラベルは 1/4・1/2・3/4 のみ。12時は 0 なので省略） */}
        {Array.from({ length: 12 }, (_, i) => {
          const r0 = isPie ? R_MAIN - STROKE - 10 : R_MAIN - STROKE / 2 - 5;
          const [x1, y1] = polar(r0, i / 12);
          const [x2, y2] = polar(r0 - (i % 3 === 0 ? 8 : 4), i / 12);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="minor-tick" />;
        })}
        {[0.25, 0.5, 0.75].map((f) => {
          const [x, y] = polar(isPie ? R_MAIN - STROKE - 28 : R_MAIN - STROKE / 2 - 22, f);
          return (
            <text key={f} x={x} y={y} className="scale-label" textAnchor="middle" dominantBaseline="central">
              {scaleLabel(scale * f, scale)}
            </text>
          );
        })}

        {/* 区切り線 */}
        {mode === 'interval' &&
          starts.map((st, i) => {
            const [x1, y1] = polar(R_MAIN - STROKE / 2 - 1, st / scale);
            const [x2, y2] = polar(R_MAIN + STROKE / 2 + 1, st / scale);
            return <line key={`sep${i}`} x1={x1} y1={y1} x2={x2} y2={y2} className="separator" />;
          })}

        {/* ハンドル（各区間の終わり） */}
        {steps.map((s, i) => {
          const end = Math.min(1, (starts[i] + s.durationSec) / scale);
          const [x, y] = polar(R_MAIN, end);
          const active = mode === 'simple' || i === selected;
          return (
            <g key={`h${i}`} className={`handle ${active ? 'active' : ''}`}>
              <circle cx={x} cy={y} r={active ? 15 : 11} className="handle-dot" stroke={kindColor(s.kind)} />
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
            <div className="dial-sub dim">タップでスタート</div>
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
