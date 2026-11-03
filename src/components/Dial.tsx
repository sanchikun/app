import type { TimerSnapshot } from '../core/engine';
import { formatClock, shortDuration } from '../core/format';
import type { StepKind } from '../core/program';
import type { DialStyle } from '../services/storage';

interface Props {
  snap: TimerSnapshot;
  style: DialStyle;
  onTap?: () => void;
}

const SIZE = 320;
const C = SIZE / 2;
const R_MAIN = 128;
const STROKE = 26;
const R_OUTER = 152;

export const kindColor = (kind: StepKind | undefined) =>
  kind === 'rest' ? 'var(--rest)' : kind === 'prepare' ? 'var(--prepare)' : 'var(--work)';

/** 12時の位置から時計回りに angle(0..1) 進んだ点 */
function polar(r: number, frac: number): [number, number] {
  const a = frac * 2 * Math.PI - Math.PI / 2;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

/** 12時から時計回りに from→to(0..1) の扇形パス */
function sectorPath(r: number, from: number, to: number): string {
  if (to - from >= 0.9999) {
    return `M ${C} ${C - r} A ${r} ${r} 0 1 1 ${C - 0.01} ${C - r} Z`;
  }
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  const large = to - from > 0.5 ? 1 : 0;
  return `M ${C} ${C} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

/**
 * 円グラフ型ダイヤル。現在の区間（例: ワーク1分）の長さでちょうど1周する。
 * 色付き部分＝残り時間で、針（ノブ）が12時から時計回りに1周すると区間が終わる。
 * 外周の細いリングはプログラム全体の進み具合（インターバル時のみ）。
 */
export function Dial({ snap, style, onTap }: Props) {
  const seg = snap.segment;
  const progress = snap.status === 'idle' ? 0 : Math.min(1, snap.segmentProgress);
  const remainingFrac = 1 - progress;
  const color = kindColor(seg?.kind);
  const multi = snap.segments.length > 1;
  const circumference = 2 * Math.PI * R_MAIN;
  const [kx, ky] = polar(R_MAIN, progress);
  const finished = snap.status === 'finished';

  const nextSeg = seg && snap.segments[seg.index + 1];
  const roundText =
    seg && seg.totalRounds > 1 && seg.round > 0 ? `ラウンド ${seg.round} / ${seg.totalRounds}` : null;

  return (
    <div className={`dial ${snap.status} style-${style}`} onClick={onTap} role="button" aria-label="タップで開始/一時停止">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="dial-svg" aria-hidden>
        {/* 外周: 全体進捗と区間の区切り */}
        {multi && (
          <g className="outer">
            <circle cx={C} cy={C} r={R_OUTER} className="outer-track" />
            {snap.segments.map((s) => {
              const from = s.startMs / snap.totalMs;
              const to = (s.startMs + s.durationMs) / snap.totalMs;
              const done = Math.min(1, Math.max(0, (snap.elapsedMs - s.startMs) / s.durationMs));
              if (done <= 0) return null;
              const [x1, y1] = polar(R_OUTER, from);
              const end = from + (to - from) * done;
              const [x2, y2] = polar(R_OUTER, Math.min(end, from + (to - from) * 0.999));
              const large = end - from > 0.5 ? 1 : 0;
              return (
                <path
                  key={s.index}
                  d={`M ${x1} ${y1} A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${x2} ${y2}`}
                  stroke={kindColor(s.kind)}
                  className="outer-progress"
                />
              );
            })}
            {snap.segments.map((s) => {
              const [x1, y1] = polar(R_OUTER - 6, s.startMs / snap.totalMs);
              const [x2, y2] = polar(R_OUTER + 6, s.startMs / snap.totalMs);
              return <line key={`t${s.index}`} x1={x1} y1={y1} x2={x2} y2={y2} className="outer-tick" />;
            })}
          </g>
        )}

        {/* 目盛り（12分割） */}
        {Array.from({ length: 12 }, (_, i) => {
          const [x1, y1] = polar(R_MAIN - STROKE / 2 - 10, i / 12);
          const [x2, y2] = polar(R_MAIN - STROKE / 2 - (i % 3 === 0 ? 20 : 15), i / 12);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="minor-tick" />;
        })}

        {style === 'ring' ? (
          <g>
            <circle cx={C} cy={C} r={R_MAIN} className="track" strokeWidth={STROKE} />
            {!finished && (
              <circle
                cx={C}
                cy={C}
                r={R_MAIN}
                className="arc"
                stroke={color}
                strokeWidth={STROKE}
                strokeDasharray={`${circumference * remainingFrac} ${circumference}`}
                strokeDashoffset={-circumference * progress}
                transform={`rotate(-90 ${C} ${C})`}
              />
            )}
          </g>
        ) : (
          <g>
            <circle cx={C} cy={C} r={R_MAIN + STROKE / 2} className="pie-bg" />
            {!finished && remainingFrac > 0 && (
              <path d={sectorPath(R_MAIN + STROKE / 2, progress, 1)} fill={color} className="pie" />
            )}
            <circle cx={C} cy={C} r={R_MAIN - STROKE - 6} className="pie-hole" />
          </g>
        )}

        {/* 針の先（ノブ） */}
        {!finished && snap.status !== 'idle' && (
          <circle cx={kx} cy={ky} r={style === 'ring' ? STROKE / 2 + 3 : 7} className="knob" />
        )}
      </svg>

      <div className="dial-center">
        {finished ? (
          <>
            <div className="dial-label">完了</div>
            <div className="dial-time done">0:00</div>
            <div className="dial-sub">お疲れさまでした</div>
          </>
        ) : (
          <>
            <div className="dial-label" style={{ color }}>
              {seg ? (multi ? seg.label : snap.status === 'paused' ? '一時停止中' : 'タイマー') : '未設定'}
            </div>
            <div className="dial-time">{formatClock(snap.segmentRemainingMs)}</div>
            {roundText && <div className="dial-sub">{roundText}</div>}
            {multi && (
              <>
                <div className="dial-sub dim">
                  {nextSeg ? `次: ${nextSeg.label} ${shortDuration(Math.round(nextSeg.durationMs / 1000))}` : '最後の区間'}
                </div>
                <div className="dial-sub dim">全体 残り {formatClock(snap.totalRemainingMs)}</div>
              </>
            )}
            {multi && snap.status === 'paused' && <div className="dial-sub">一時停止中</div>}
          </>
        )}
      </div>
    </div>
  );
}
