import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { MAX_TOTAL_SEC, scaleLabel } from '../core/dialScale';
import { formatClock, shortDuration } from '../core/format';
import { EditorSummary } from './DialEditor';
import { kindColor, lapView, RunningSummary, type RunningViewProps } from './Dial';
import { useTimeEditor, type TimeEditorProps } from './useTimeEditor';

/** ラベルが途中で切れずに収まるのに必要なおおよその幅（バー全幅=1、スマホ幅 約340px 基準） */
const labelNeeds = (label: string) => (label.length * 12 + 16) / 340;

const pct = (f: number) => `${Math.max(0, Math.min(1, f)) * 100}%`;

/** バーの中の1区間（色付きブロック）。幅があれば名前と長さを中に表示 */
function Block({
  from,
  to,
  kind,
  opacity,
  roundEdge,
  label,
}: {
  from: number;
  to: number;
  kind: Parameters<typeof kindColor>[0];
  opacity: number;
  roundEdge: boolean;
  label?: string;
}) {
  const style: CSSProperties = {
    left: pct(from),
    width: pct(to - from),
    background: kindColor(kind),
    opacity,
  };
  return (
    <div className={`bar-block ${roundEdge ? 'round-edge' : ''} ${from > 0.0001 ? 'has-sep' : ''}`} style={style}>
      {label && to - from >= labelNeeds(label) && <span className="bar-block-label">{label}</span>}
    </div>
  );
}

/**
 * 動作中のバー表示。左から右へ進む。
 * バーの全幅＝「1周」の範囲（Nラウンド / 全体）で、各区間を色分けしたブロックで並べる。
 * 色付き部分＝これからの時間。白い縦線（今の位置）が右端に着くとその範囲が終わる。
 */
export function BarView({ snap, lap: lapUnit, onTap }: RunningViewProps) {
  const { seg, finished, laps, progress, lapSegments, mainLaps, frac } = lapView(snap, lapUnit);
  return (
    <div className={`bar-view ${snap.status}`} onClick={onTap} role="button" aria-label="タップで開始/一時停止">
      <div className="bar-head">
        <RunningSummary snap={snap} part="head" />
      </div>
      <div className="bar">
        <div className="bar-fill">
          {!finished &&
            lapSegments.map((s, i) => {
              const from = Math.max(frac(s.startMs), progress);
              const to = frac(s.startMs + s.durationMs);
              if (to - from <= 0.0005) return null;
              return (
                <Block
                  key={s.index}
                  from={from}
                  to={to}
                  kind={s.kind}
                  opacity={s.index === seg?.index ? 1 : 0.55}
                  roundEdge={i > 0 && s.stepIndex === 0 && from === frac(s.startMs)}
                  label={
                    from === frac(s.startMs) || s.index === seg?.index
                      ? `${s.label} ${shortDuration(Math.round(s.durationMs / 1000))}`
                      : undefined
                  }
                />
              );
            })}
        </div>
        {!finished && <div className="bar-cursor" style={{ left: pct(progress) }} />}
      </div>
      {mainLaps > 1 && (
        <div className="bar-total" aria-label="全体の進み具合">
          <div className="bar-total-fill" style={{ width: pct(snap.totalProgress) }} />
          {laps.map((l) =>
            l.index === 0 ? null : (
              <span key={l.index} className="bar-total-tick" style={{ left: pct(l.startMs / snap.totalMs) }} />
            ),
          )}
        </div>
      )}
      <div className="bar-foot">
        <RunningSummary snap={snap} part="foot" />
      </div>
    </div>
  );
}

/**
 * 設定用のバー。左右にドラッグして時間を決める。
 * - タイマー: バーをなぞる／つまみを動かすと時間が決まる。全幅の長さは自動（下に目盛り）
 * - インターバル: 全幅＝プログラム全体。区間の境目のつまみを動かすと、合計はそのままで配分（割合）が変わる
 */
export function BarEditor(props: TimeEditorProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const toPoint = (e: ReactPointerEvent) => {
    const rect = barRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const zone = y >= -28 && y <= rect.height + 28 ? 'track' : 'center';
    return { x, y, zone, frac: x / rect.width } as const;
  };
  const { simple, wedges, handles, scale, dragging, sel, handlers } = useTimeEditor(props, {
    wraps: false,
    handleHit: 0.06,
    toPoint,
  });
  const { mode, selected, steps, rounds } = props;
  const summary = { mode, steps, sel, rounds };

  return (
    <div className={`bar-view editor ${dragging ? 'dragging' : ''}`} {...handlers}>
      <div className="bar-head">
        <EditorSummary {...summary} part="head" />
      </div>
      <div
        className="bar"
        ref={barRef}
        role="slider"
        aria-label="左右に動かして時間を設定"
        aria-valuemin={0}
        aria-valuemax={MAX_TOTAL_SEC}
        aria-valuenow={sel?.durationSec ?? 0}
        aria-valuetext={formatClock((sel?.durationSec ?? 0) * 1000)}
      >
        <div className="bar-fill">
          {wedges.map((w, i) => {
            if (w.durationSec <= 0) return null;
            const from = w.startSec / scale;
            const to = Math.min(1, (w.startSec + w.durationSec) / scale);
            if (to <= from) return null;
            const isSel = simple || w.stepIndex === selected;
            return (
              <Block
                key={i}
                from={from}
                to={to}
                kind={w.kind}
                opacity={(isSel ? 1 : 0.45) * (w.round === 1 ? 1 : 0.7)}
                roundEdge={i > 0 && w.stepIndex === 0}
                label={simple ? undefined : steps[w.stepIndex]?.label}
              />
            );
          })}
        </div>
        {handles.filter((h) => h.visible).map((h) => (
          <div
            key={h.key}
            className={`bar-handle ${h.active ? 'active' : ''}`}
            style={{ left: pct(h.frac), borderColor: kindColor(h.kind) }}
          />
        ))}
      </div>
      {simple && (
        <div className="bar-scale" aria-hidden>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <span key={f} style={{ left: pct(f) }}>
              {f === 0 ? '0' : scaleLabel(scale * f, scale)}
            </span>
          ))}
        </div>
      )}
      <div className="bar-foot">
        <EditorSummary {...summary} part="foot" />
      </div>
    </div>
  );
}
