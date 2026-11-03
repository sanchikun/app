import { useState } from 'react';
import { formatClock, shortDuration } from '../core/format';
import { lapLabel, roundsPerLap, type LapUnit } from '../core/laps';
import { buildSegments, makeStep, programLap, totalDurationMs, type Program, type Step, type StepKind } from '../core/program';
import { DurationInput } from './DurationInput';
import { Sheet } from './Sheet';

interface Props {
  program: Program;
  onChange(p: Program): void;
  onSavePreset(p: Program): void;
  onClose(): void;
}

/** select の値（N回ごとが全体と同じになる場合は全体にまとめる） */
function lapValue(unit: LapUnit, rounds: number): string {
  return lapLabel(unit, rounds) === '全体' ? 'all' : String(roundsPerLap(unit, rounds));
}

const KIND_LABEL: Record<StepKind, string> = { work: 'ワーク', rest: '休憩', prepare: '準備' };

/** インターバルの詳細設定（区間の追加・削除・名前、準備時間など） */
export function IntervalSheet({ program, onChange, onSavePreset, onClose }: Props) {
  const [saved, setSaved] = useState(false);
  const total = totalDurationMs(buildSegments(program));
  const update = (patch: Partial<Program>) => {
    setSaved(false);
    onChange({ ...program, ...patch });
  };
  const updateStep = (id: string, patch: Partial<Step>) =>
    update({ steps: program.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= program.steps.length) return;
    const steps = [...program.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    update({ steps });
  };
  const addStep = () => {
    const last = program.steps[program.steps.length - 1];
    const kind: StepKind = last?.kind === 'work' ? 'rest' : 'work';
    update({ steps: [...program.steps, makeStep(KIND_LABEL[kind], kind === 'rest' ? 30 : 60, kind)] });
  };

  return (
    <Sheet title="インターバルの詳細" onClose={onClose}>
      <div className="tab-body">
        <label className="field">
          <span>名前</span>
          <input value={program.name} onChange={(e) => update({ name: e.target.value })} />
        </label>

        <ol className="steps">
          {program.steps.map((s, i) => (
            <li key={s.id} className={`step kind-${s.kind}`}>
              <div className="step-head">
                <input
                  className="step-label"
                  value={s.label}
                  onChange={(e) => updateStep(s.id, { label: e.target.value })}
                  aria-label="区間の名前"
                />
                <select value={s.kind} onChange={(e) => updateStep(s.id, { kind: e.target.value as StepKind })} aria-label="種類">
                  <option value="work">ワーク</option>
                  <option value="rest">休憩</option>
                </select>
              </div>
              <div className="step-body">
                <DurationInput value={s.durationSec} onChange={(v) => updateStep(s.id, { durationSec: v })} label={s.label} />
                <div className="step-tools">
                  <button className="icon" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="上へ">↑</button>
                  <button className="icon" onClick={() => moveStep(i, 1)} disabled={i === program.steps.length - 1} aria-label="下へ">↓</button>
                  <button
                    className="icon danger"
                    onClick={() => update({ steps: program.steps.filter((x) => x.id !== s.id) })}
                    disabled={program.steps.length <= 1}
                    aria-label="削除"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <button className="btn ghost wide" onClick={addStep}>＋ 区間を追加</button>

        <div className="grid2">
          <label className="field">
            <span>繰り返し</span>
            <div className="stepper">
              <button className="icon" onClick={() => update({ rounds: Math.max(1, program.rounds - 1) })}>−</button>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={program.rounds}
                onChange={(e) => update({ rounds: Math.min(99, Math.max(1, Math.floor(Number(e.target.value)) || 1)) })}
              />
              <button className="icon" onClick={() => update({ rounds: Math.min(99, program.rounds + 1) })}>＋</button>
              <span>回</span>
            </div>
          </label>
          <label className="field">
            <span>準備時間</span>
            <div className="stepper">
              <button className="icon" onClick={() => update({ prepareSec: Math.max(0, program.prepareSec - 5) })}>−</button>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
                value={program.prepareSec}
                onChange={(e) => update({ prepareSec: Math.min(60, Math.max(0, Math.floor(Number(e.target.value)) || 0)) })}
              />
              <button className="icon" onClick={() => update({ prepareSec: Math.min(60, program.prepareSec + 5) })}>＋</button>
              <span>秒</span>
            </div>
          </label>
        </div>
        <label className="field inline">
          <span>ダイヤル1周の範囲</span>
          <select
            value={lapValue(programLap(program), program.rounds)}
            onChange={(e) => {
              const v = e.target.value;
              update({ lap: v === 'all' ? 'all' : Number(v) });
            }}
          >
            {Array.from({ length: Math.max(0, program.rounds - 1) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}回ごと
              </option>
            ))}
            <option value="all">全体（{program.rounds}回ぶん）</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={program.skipLastRest} onChange={(e) => update({ skipLastRest: e.target.checked })} />
          最後のラウンドの休憩は省略する
        </label>

        <p className="summary">
          {program.steps.map((s) => `${s.label} ${shortDuration(s.durationSec)}`).join(' → ')} を {program.rounds} 回
          ・合計 <strong>{formatClock(total)}</strong>
        </p>

        <div className="row actions">
          <button
            className="btn ghost"
            disabled={total <= 0}
            onClick={() => {
              onSavePreset(program);
              setSaved(true);
            }}
          >
            {saved ? '保存しました' : 'プリセットに保存'}
          </button>
          <button className="btn accent" onClick={onClose}>完了</button>
        </div>
      </div>
    </Sheet>
  );
}
