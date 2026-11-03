import type { TimerSnapshot } from '../core/engine';
import { formatClock, shortDuration } from '../core/format';
import { buildLaps, lapOf, type LapUnit } from '../core/laps';
import type { StepKind } from '../core/program';
import { arcPath, C, polar, R_MAIN, R_OUTER, SIZE, STROKE } from './dialGeometry';

export interface RunningViewProps {
  snap: TimerSnapshot;
  /** 1周（バーなら全幅）が表す範囲（Nラウンドごと / 全体） */
  lap: LapUnit;
  onTap?: () => void;
}

export const kindColor = (kind: StepKind | undefined) =>
  kind === 'rest' ? 'var(--rest)' : kind === 'prepare' ? 'var(--prepare)' : 'var(--work)';

/** 動作中の表示に必要な「今の周」の情報（リング・バー共通） */
export function lapView(snap: TimerSnapshot, lapUnit: LapUnit) {
  const seg = snap.segment;
  const finished = snap.status === 'finished';
  const laps = buildLaps(snap.segments, lapUnit);
  const lap = seg ? lapOf(laps, seg.index) : null;
  const lapStart = lap?.startMs ?? 0;
  const lapDur = lap?.durationMs || 1;
  const progress = finished ? 1 : Math.min(1, Math.max(0, (snap.elapsedMs - lapStart) / lapDur));
  const lapSegments = lap ? snap.segments.slice(lap.first, lap.last + 1) : [];
  // 準備区間を除いて2周以上あるときだけ、全体の進み具合を別に出す
  const mainLaps = laps.filter((l) => snap.segments[l.first]?.kind !== 'prepare').length;
  const frac = (ms: number) => (ms - lapStart) / lapDur;
  return { seg, finished, laps, lap, progress, lapSegments, mainLaps, frac };
}

/** 動作中に中央（バーなら上下）に出す文字情報 */
export function RunningSummary({ snap, part }: { snap: TimerSnapshot; part?: 'head' | 'foot' }) {
  const seg = snap.segment;
  const multi = snap.segments.length > 1;
  const color = kindColor(seg?.kind);
  const nextSeg = seg && snap.segments[seg.index + 1];
  const roundText =
    seg && seg.totalRounds > 1 && seg.round > 0 ? `ラウンド ${seg.round} / ${seg.totalRounds}` : null;

  if (snap.status === 'finished') {
    return (
      <>
        {part !== 'foot' && (
          <>
            <div className="dial-label">完了</div>
            <div className="dial-time done">0:00</div>
          </>
        )}
        {part !== 'head' && <div className="dial-sub">お疲れさまでした</div>}
      </>
    );
  }
  return (
    <>
      {part !== 'foot' && (
        <>
          <div className="dial-label" style={{ color }}>
            {seg ? (multi ? seg.label : snap.status === 'paused' ? '一時停止中' : 'タイマー') : '未設定'}
          </div>
          <div className="dial-time">{formatClock(snap.segmentRemainingMs)}</div>
        </>
      )}
      {part !== 'head' && (
        <>
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
    </>
  );
}

/**
 * 動作中の円グラフ型ダイヤル（リング）。
 * 「1周」の範囲（Nラウンド / 全体）の長さでちょうど1周し、
 * その中の各区間（ワーク・休憩）を色分けした扇形で並べる。
 * 色付き部分＝これからの時間で、針が12時から時計回りに1周するとその範囲が終わる。
 * 外周の細いリングはプログラム全体の進み具合（1周が全体でないときのみ）。
 */
export function Dial({ snap, lap: lapUnit, onTap }: RunningViewProps) {
  const { seg, finished, laps, progress, lapSegments, mainLaps, frac } = lapView(snap, lapUnit);
  const [kx, ky] = polar(R_MAIN, progress);

  return (
    <div className={`dial ${snap.status}`} onClick={onTap} role="button" aria-label="タップで開始/一時停止">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="dial-svg" aria-hidden>
        {/* 外周: 全体進捗と周の区切り */}
        {mainLaps > 1 && (
          <g className="outer">
            <circle cx={C} cy={C} r={R_OUTER} className="outer-track" />
            {snap.segments.map((s) => {
              const done = Math.min(1, Math.max(0, (snap.elapsedMs - s.startMs) / s.durationMs));
              if (done <= 0) return null;
              const from = s.startMs / snap.totalMs;
              const to = (s.startMs + s.durationMs * done) / snap.totalMs;
              return (
                <path
                  key={s.index}
                  d={arcPath(R_OUTER, from, Math.max(from + 0.0001, to - 0.0001))}
                  stroke={kindColor(s.kind)}
                  className="outer-progress"
                />
              );
            })}
            {laps.map((l) => {
              const [x1, y1] = polar(R_OUTER - 6, l.startMs / snap.totalMs);
              const [x2, y2] = polar(R_OUTER + 6, l.startMs / snap.totalMs);
              return <line key={`t${l.index}`} x1={x1} y1={y1} x2={x2} y2={y2} className="outer-tick" />;
            })}
          </g>
        )}

        <circle cx={C} cy={C} r={R_MAIN} className="track" strokeWidth={STROKE} />

        {/* この周の各区間: 残っている部分だけ色付きで描く */}
        {!finished &&
          lapSegments.map((s) => {
            const from = Math.max(frac(s.startMs), progress);
            const to = frac(s.startMs + s.durationMs);
            if (to - from <= 0.0005) return null;
            const current = s.index === seg?.index;
            return (
              <path
                key={s.index}
                d={arcPath(R_MAIN, from, to)}
                stroke={kindColor(s.kind)}
                strokeWidth={STROKE}
                fill="none"
                opacity={current ? 1 : 0.55}
              />
            );
          })}

        {/* 区間の区切り線 */}
        {lapSegments.length > 1 &&
          lapSegments.map((s, i) => {
            if (i === 0) return null;
            const f = frac(s.startMs);
            const [x1, y1] = polar(R_MAIN - STROKE / 2 - 1, f);
            const [x2, y2] = polar(R_MAIN + STROKE / 2 + 1, f);
            return (
              <line
                key={`sep${s.index}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className={`separator ${s.stepIndex === 0 ? 'round-edge' : ''}`}
              />
            );
          })}

        {/* 目盛り（12分割） */}
        {Array.from({ length: 12 }, (_, i) => {
          const r0 = R_MAIN - STROKE / 2 - 10;
          const [x1, y1] = polar(r0, i / 12);
          const [x2, y2] = polar(r0 - (i % 3 === 0 ? 10 : 5), i / 12);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="minor-tick" />;
        })}

        {/* 針の先（ノブ） */}
        {!finished && <circle cx={kx} cy={ky} r={STROKE / 2 + 3} className="knob" />}
      </svg>

      <div className="dial-center">
        <RunningSummary snap={snap} />
      </div>
    </div>
  );
}
