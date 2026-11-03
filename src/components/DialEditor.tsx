import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { angleFrac, MAX_TOTAL_SEC, scaleLabel } from '../core/dialScale';
import { formatClock } from '../core/format';
import { shares } from '../core/split';
import { kindColor } from './Dial';
import { arcPath, C, polar, R_MAIN, SIZE, STROKE } from './dialGeometry';
import { useTimeEditor, type EditorStep, type TimeEditorProps } from './useTimeEditor';

/**
 * 設定用の円グラフ（リング）。
 * - タイマー: 円をなぞる／つまみを回すと時間が決まる（キッチンタイマーの要領）。1周の長さは自動で切替
 * - インターバル: 1周＝プログラム全体。区間の境目のつまみを回すと、合計はそのままで配分（割合）が変わる
 */
export function DialEditor(props: TimeEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const toPoint = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * SIZE;
    const r = Math.hypot(x - C, y - C);
    const zone = r < R_MAIN - STROKE / 2 - 10 ? 'center' : r > R_MAIN + STROKE / 2 + 30 ? 'outside' : 'track';
    return { x, y, zone, frac: angleFrac(C, C, x, y) } as const;
  };
  const { simple, wedges, handles, scale, dragging, sel, handlers } = useTimeEditor(props, {
    wraps: true,
    handleHit: 0.05,
    toPoint,
  });
  const { selected } = props;

  return (
    <div className={`dial editor ${dragging ? 'dragging' : ''}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="dial-svg"
        {...handlers}
        role="slider"
        aria-label="ダイヤルを回して時間を設定"
        aria-valuemin={0}
        aria-valuemax={MAX_TOTAL_SEC}
        aria-valuenow={sel?.durationSec ?? 0}
        aria-valuetext={formatClock((sel?.durationSec ?? 0) * 1000)}
      >
        <circle cx={C} cy={C} r={R_MAIN} className="track" strokeWidth={STROKE} />

        {/* 扇形（各区間。2サイクル目以降は少し淡く） */}
        {wedges.map((w, i) => {
          if (w.durationSec <= 0) return null;
          const from = w.startSec / scale;
          const to = Math.min(1, (w.startSec + w.durationSec) / scale);
          if (to <= from) return null;
          const isSel = simple || w.stepIndex === selected;
          const opacity = (isSel ? 1 : 0.45) * (w.round === 1 ? 1 : 0.7);
          return (
            <path key={i} d={arcPath(R_MAIN, from, to)} stroke={kindColor(w.kind)} strokeWidth={STROKE} fill="none" opacity={opacity} />
          );
        })}

        {/* 目盛り（タイマーのみ。1/4・1/2・3/4 にラベル） */}
        {simple &&
          Array.from({ length: 12 }, (_, i) => {
            const r0 = R_MAIN - STROKE / 2 - 5;
            const [x1, y1] = polar(r0, i / 12);
            const [x2, y2] = polar(r0 - (i % 3 === 0 ? 8 : 4), i / 12);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="minor-tick" />;
          })}
        {simple &&
          [0.25, 0.5, 0.75].map((f) => {
            const [x, y] = polar(R_MAIN - STROKE / 2 - 22, f);
            return (
              <text key={f} x={x} y={y} className="scale-label" textAnchor="middle" dominantBaseline="central">
                {scaleLabel(scale * f, scale)}
              </text>
            );
          })}

        {/* 区切り線（サイクルの境目は太め） */}
        {!simple &&
          wedges.map((w, i) => {
            const f = w.startSec / scale;
            if (f >= 1) return null;
            const [x1, y1] = polar(R_MAIN - STROKE / 2 - 1, f);
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

        {/* つまみ */}
        {handles.map((h) => {
          if (!h.visible) return null;
          const [x, y] = polar(R_MAIN, h.frac);
          return (
            <g key={h.key} className={`handle ${h.active ? 'active' : ''}`}>
              <circle cx={x} cy={y} r={h.active ? 15 : 11} className="handle-dot" stroke={kindColor(h.kind)} />
            </g>
          );
        })}
      </svg>

      <div className="dial-center">
        <EditorSummary mode={props.mode} steps={props.steps} sel={sel} rounds={props.rounds} />
      </div>
    </div>
  );
}

/** 設定中に中央（バーなら上下）に出す文字情報。part で上半分（名前・時間）/ 下半分（補足）だけ出せる */
export function EditorSummary({
  mode,
  steps,
  sel,
  rounds,
  part,
}: {
  mode: 'simple' | 'interval';
  steps: EditorStep[];
  sel: EditorStep | undefined;
  rounds: number;
  part?: 'head' | 'foot';
}) {
  const dur = sel?.durationSec ?? 0;
  const head = (
    <>
      <div className="dial-label" style={{ color: kindColor(sel?.kind) }}>
        {mode === 'simple' ? 'タイマー' : sel?.label}
      </div>
      <div className="dial-time">{formatClock(dur * 1000)}</div>
    </>
  );
  const sh = shares(steps);
  const foot =
    mode === 'simple' ? (
      <div className="dial-sub dim">{dur > 0 ? 'タップでスタート' : 'なぞって時間を設定'}</div>
    ) : (
      <>
        <div className="dial-sub">
          合計 {formatClock(steps.reduce((a, s) => a + s.durationSec, 0) * rounds * 1000)}
          {rounds > 1 ? ` ・ ×${rounds}` : ''}
        </div>
        <div className="dial-sub dim">
          ワーク {sh.work}% ・ 休憩 {sh.rest}%
        </div>
      </>
    );
  return (
    <>
      {part !== 'foot' && head}
      {part !== 'head' && foot}
    </>
  );
}
