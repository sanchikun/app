import { nudge } from '../core/dialScale';
import { formatClock } from '../core/format';
import type { Program } from '../core/program';
import { kindColor } from './Dial';

const QUICK_MIN = [1, 3, 5, 10, 30];

export function SimpleEditBar({ sec, onChange }: { sec: number; onChange(sec: number): void }) {
  return (
    <div className="edit-bar">
      <div className="edit-row">
        <button className="icon" onClick={() => onChange(nudge(sec, -1))} disabled={sec <= 0} aria-label="短くする">
          −
        </button>
        <div className="quick">
          {QUICK_MIN.map((m) => (
            <button key={m} className={`chip ${sec === m * 60 ? 'active' : ''}`} onClick={() => onChange(m * 60)}>
              {m}分
            </button>
          ))}
        </div>
        <button className="icon" onClick={() => onChange(nudge(sec, 1))} aria-label="長くする">
          ＋
        </button>
      </div>
    </div>
  );
}

interface IntervalProps {
  program: Program;
  selected: number;
  onSelect(i: number): void;
  onDuration(i: number, sec: number): void;
  onToggleKind(i: number): void;
  onRounds(n: number): void;
  onOpenDetail(): void;
  /** 1周の範囲の表示名（「1回ごと」「全体」など） */
  lapName: string;
  onCycleLap(): void;
}

export function IntervalEditBar({
  program,
  selected,
  onSelect,
  onDuration,
  onToggleKind,
  onRounds,
  onOpenDetail,
  lapName,
  onCycleLap,
}: IntervalProps) {
  const step = program.steps[selected];
  return (
    <div className="edit-bar">
      <div className="edit-row">
        <div className="step-pills" role="tablist" aria-label="区間">
          {program.steps.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={i === selected}
              className={`pill ${i === selected ? 'active' : ''}`}
              style={{ ['--pill' as string]: kindColor(s.kind) }}
              onClick={() => (i === selected ? onToggleKind(i) : onSelect(i))}
              title={i === selected ? 'タップでワーク/休憩を切り替え' : undefined}
            >
              {s.label} {formatClock(s.durationSec * 1000)}
            </button>
          ))}
        </div>
        <button className="lap-chip" onClick={onCycleLap} aria-label={`1周の範囲: ${lapName}（タップで切り替え）`} title="1周の範囲を切り替え">
          <span className="lap-chip-head">1周</span>
          {lapName}
        </button>
        <button className="icon" onClick={onOpenDetail} aria-label="インターバルの詳細設定">
          ⋯
        </button>
      </div>
      <div className="edit-row">
        <div className="group">
          <button
            className="icon"
            onClick={() => step && onDuration(selected, nudge(step.durationSec, -1, 5))}
            disabled={!step || step.durationSec <= 5}
            aria-label={`${step?.label}を短くする`}
          >
            −
          </button>
          <span className="group-label" style={{ color: kindColor(step?.kind) }}>
            {step?.label}
          </span>
          <button
            className="icon"
            onClick={() => step && onDuration(selected, nudge(step.durationSec, 1, 5))}
            aria-label={`${step?.label}を長くする`}
          >
            ＋
          </button>
        </div>
        <div className="group">
          <button className="icon" onClick={() => onRounds(Math.max(1, program.rounds - 1))} disabled={program.rounds <= 1} aria-label="回数を減らす">
            −
          </button>
          <span className="group-label">×{program.rounds}回</span>
          <button className="icon" onClick={() => onRounds(Math.min(99, program.rounds + 1))} aria-label="回数を増やす">
            ＋
          </button>
        </div>
      </div>
    </div>
  );
}
