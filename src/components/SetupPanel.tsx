import { useState } from 'react';
import { formatClock, shortDuration } from '../core/format';
import {
  buildSegments,
  isSimple,
  makeStep,
  newId,
  simpleProgram,
  totalDurationMs,
  type Program,
  type Step,
  type StepKind,
} from '../core/program';
import { DurationInput } from './DurationInput';

type Tab = 'simple' | 'interval' | 'presets';

interface Props {
  program: Program;
  presets: Program[];
  onApply(program: Program, autoStart: boolean): void;
  onSavePreset(program: Program): void;
  onDeletePreset(id: string): void;
}

const QUICK = [1, 3, 5, 10, 15, 30];

export function SetupPanel({ program, presets, onApply, onSavePreset, onDeletePreset }: Props) {
  const [tab, setTab] = useState<Tab>(isSimple(program) ? 'simple' : 'interval');
  return (
    <section className="panel">
      <div className="tabs" role="tablist">
        {(
          [
            ['simple', 'タイマー'],
            ['interval', 'インターバル'],
            ['presets', 'プリセット'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`tab ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'simple' && <SimpleTab program={program} onApply={onApply} />}
      {tab === 'interval' && <IntervalTab program={program} onApply={onApply} onSavePreset={onSavePreset} />}
      {tab === 'presets' && (
        <PresetsTab
          presets={presets}
          onApply={(p) => {
            onApply(p, false);
            setTab(isSimple(p) ? 'simple' : 'interval');
          }}
          onDelete={onDeletePreset}
        />
      )}
    </section>
  );
}

function SimpleTab({ program, onApply }: { program: Program; onApply: Props['onApply'] }) {
  const [sec, setSec] = useState(isSimple(program) ? program.steps[0].durationSec : 180);
  return (
    <div className="tab-body">
      <div className="chips">
        {QUICK.map((m) => (
          <button key={m} className="chip" onClick={() => {
            setSec(m * 60);
            onApply(simpleProgram(m * 60), false);
          }}>
            {m}分
          </button>
        ))}
      </div>
      <div className="row">
        <DurationInput value={sec} onChange={setSec} label="時間" />
      </div>
      <div className="row actions">
        <button className="btn" disabled={sec <= 0} onClick={() => onApply(simpleProgram(sec), false)}>
          セット
        </button>
        <button className="btn accent" disabled={sec <= 0} onClick={() => onApply(simpleProgram(sec), true)}>
          セットして開始
        </button>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<StepKind, string> = { work: 'ワーク', rest: '休憩', prepare: '準備' };

function cloneForEdit(p: Program): Program {
  if (!isSimple(p)) return { ...p, steps: p.steps.map((s) => ({ ...s })) };
  return {
    id: newId('prog'),
    name: 'インターバル',
    steps: [makeStep('ワーク', 60, 'work'), makeStep('休憩', 30, 'rest')],
    rounds: 5,
    prepareSec: 5,
    skipLastRest: true,
  };
}

function IntervalTab({
  program,
  onApply,
  onSavePreset,
}: {
  program: Program;
  onApply: Props['onApply'];
  onSavePreset: Props['onSavePreset'];
}) {
  const [draft, setDraft] = useState<Program>(() => cloneForEdit(program));
  const [saved, setSaved] = useState(false);
  const total = totalDurationMs(buildSegments(draft));

  const update = (patch: Partial<Program>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const updateStep = (id: string, patch: Partial<Step>) =>
    update({ steps: draft.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const removeStep = (id: string) => update({ steps: draft.steps.filter((s) => s.id !== id) });
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.steps.length) return;
    const steps = [...draft.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    update({ steps });
  };
  const addStep = () => {
    const last = draft.steps[draft.steps.length - 1];
    const kind: StepKind = last?.kind === 'work' ? 'rest' : 'work';
    update({ steps: [...draft.steps, makeStep(KIND_LABEL[kind], kind === 'rest' ? 30 : 60, kind)] });
  };

  const valid = total > 0;
  const apply = (autoStart: boolean) => onApply({ ...draft, id: newId('prog'), steps: draft.steps.map((s) => ({ ...s })) }, autoStart);

  return (
    <div className="tab-body">
      <label className="field">
        <span>名前</span>
        <input value={draft.name} onChange={(e) => update({ name: e.target.value })} />
      </label>

      <ol className="steps">
        {draft.steps.map((s, i) => (
          <li key={s.id} className={`step kind-${s.kind}`}>
            <div className="step-head">
              <input
                className="step-label"
                value={s.label}
                onChange={(e) => updateStep(s.id, { label: e.target.value })}
                aria-label="ステップ名"
              />
              <select
                value={s.kind}
                onChange={(e) => updateStep(s.id, { kind: e.target.value as StepKind })}
                aria-label="種類"
              >
                <option value="work">ワーク</option>
                <option value="rest">休憩</option>
              </select>
            </div>
            <div className="step-body">
              <DurationInput value={s.durationSec} onChange={(v) => updateStep(s.id, { durationSec: v })} label={s.label} />
              <div className="step-tools">
                <button className="icon" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="上へ">↑</button>
                <button className="icon" onClick={() => moveStep(i, 1)} disabled={i === draft.steps.length - 1} aria-label="下へ">↓</button>
                <button className="icon danger" onClick={() => removeStep(s.id)} disabled={draft.steps.length <= 1} aria-label="削除">✕</button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <button className="btn ghost wide" onClick={addStep}>＋ ステップを追加</button>

      <div className="grid2">
        <label className="field">
          <span>繰り返し</span>
          <div className="stepper">
            <button className="icon" onClick={() => update({ rounds: Math.max(1, draft.rounds - 1) })}>−</button>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={draft.rounds}
              onChange={(e) => update({ rounds: Math.min(99, Math.max(1, Math.floor(Number(e.target.value)) || 1)) })}
            />
            <button className="icon" onClick={() => update({ rounds: Math.min(99, draft.rounds + 1) })}>＋</button>
            <span>回</span>
          </div>
        </label>
        <label className="field">
          <span>準備時間</span>
          <div className="stepper">
            <button className="icon" onClick={() => update({ prepareSec: Math.max(0, draft.prepareSec - 5) })}>−</button>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              value={draft.prepareSec}
              onChange={(e) => update({ prepareSec: Math.min(60, Math.max(0, Math.floor(Number(e.target.value)) || 0)) })}
            />
            <button className="icon" onClick={() => update({ prepareSec: Math.min(60, draft.prepareSec + 5) })}>＋</button>
            <span>秒</span>
          </div>
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.skipLastRest}
          onChange={(e) => update({ skipLastRest: e.target.checked })}
        />
        最後のラウンドの休憩は省略する
      </label>

      <p className="summary">
        {draft.steps.map((s) => `${s.label} ${shortDuration(s.durationSec)}`).join(' → ')} を {draft.rounds} 回
        ・合計 <strong>{formatClock(total)}</strong>
      </p>

      <div className="row actions">
        <button className="btn ghost" disabled={!valid} onClick={() => {
          onSavePreset({ ...draft, id: newId('preset'), steps: draft.steps.map((s) => ({ ...s, id: newId('step') })) });
          setSaved(true);
        }}>
          {saved ? '保存しました' : 'プリセットに保存'}
        </button>
        <button className="btn" disabled={!valid} onClick={() => apply(false)}>セット</button>
        <button className="btn accent" disabled={!valid} onClick={() => apply(true)}>セットして開始</button>
      </div>
    </div>
  );
}

function PresetsTab({
  presets,
  onApply,
  onDelete,
}: {
  presets: Program[];
  onApply(p: Program): void;
  onDelete(id: string): void;
}) {
  if (presets.length === 0) return <div className="tab-body empty">プリセットはまだありません。インターバル画面から保存できます。</div>;
  return (
    <div className="tab-body">
      <ul className="presets">
        {presets.map((p) => {
          const total = totalDurationMs(buildSegments(p));
          return (
            <li key={p.id} className="preset">
              <button className="preset-main" onClick={() => onApply({ ...p, id: newId('prog') })}>
                <span className="preset-name">{p.name}</span>
                <span className="preset-meta">
                  {p.steps.map((s) => shortDuration(s.durationSec)).join(' / ')}
                  {p.rounds > 1 ? ` ×${p.rounds}` : ''} ・ {formatClock(total)}
                </span>
              </button>
              <button className="icon danger" onClick={() => onDelete(p.id)} aria-label={`${p.name}を削除`}>
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
