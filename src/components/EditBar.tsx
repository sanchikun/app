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
  onToggleKind(i: number): void;
  /** 合計時間を1段階増減（配分の割合は保つ） */
  onTotal(direction: 1 | -1): void;
  /** 繰り返し回数を変える（合計は保ち、1サイクルが短く/長くなる） */
  onRounds(n: number): void;
  /** 選択中の区間の真ん中に反対の区間（ワークなら休憩）を入れる */
  onInsert(): void;
  canInsert: boolean;
  onRemove(): void;
  onOpenDetail(): void;
}

export function IntervalEditBar({
  program,
  selected,
  onSelect,
  onToggleKind,
  onTotal,
  onRounds,
  onInsert,
  canInsert,
  onRemove,
  onOpenDetail,
}: IntervalProps) {
  const step = program.steps[selected];
  const totalSec = program.steps.reduce((a, s) => a + s.durationSec, 0) * program.rounds;
  const insertLabel = step?.kind === 'rest' ? '＋ワーク' : '＋休憩';
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
        <button className="btn small-action" onClick={onInsert} disabled={!canInsert} title={`選択中の区間の途中に${insertLabel.slice(1)}を入れる`}>
          {insertLabel}
        </button>
        <button
          className="icon danger"
          onClick={onRemove}
          disabled={program.steps.length <= 1}
          aria-label={`${step?.label ?? '区間'}を削除`}
          title="選択中の区間を削除（時間は隣の区間へ）"
        >
          🗑
        </button>
        <button className="icon" onClick={onOpenDetail} aria-label="インターバルの詳細設定">
          ⋯
        </button>
      </div>
      <div className="edit-row">
        <div className="group">
          <button className="icon" onClick={() => onTotal(-1)} aria-label="合計を短くする">
            −
          </button>
          <span className="group-label">合計 {formatClock(totalSec * 1000)}</span>
          <button className="icon" onClick={() => onTotal(1)} aria-label="合計を長くする">
            ＋
          </button>
        </div>
        <div className="group narrow">
          <button className="icon" onClick={() => onRounds(Math.max(1, program.rounds - 1))} disabled={program.rounds <= 1} aria-label="繰り返しを減らす">
            −
          </button>
          <span className="group-label">×{program.rounds}</span>
          <button className="icon" onClick={() => onRounds(Math.min(20, program.rounds + 1))} aria-label="繰り返しを増やす">
            ＋
          </button>
        </div>
      </div>
    </div>
  );
}
