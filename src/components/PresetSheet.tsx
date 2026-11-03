import { useState } from 'react';
import { formatClock, shortDuration } from '../core/format';
import { buildSegments, totalDurationMs, type Program } from '../core/program';
import { Sheet } from './Sheet';

interface Props {
  presets: Program[];
  current: Program;
  onApply(p: Program): void;
  onSave(p: Program): void;
  onDelete(id: string): void;
  onClose(): void;
}

export function PresetSheet({ presets, current, onApply, onSave, onDelete, onClose }: Props) {
  const [saved, setSaved] = useState(false);
  const total = totalDurationMs(buildSegments(current));
  return (
    <Sheet title="プリセット" onClose={onClose}>
      <div className="tab-body">
        <button
          className="btn ghost wide"
          disabled={total <= 0 || saved}
          onClick={() => {
            onSave(current);
            setSaved(true);
          }}
        >
          {saved ? '保存しました' : `＋ 今の設定を保存（${current.name} ${formatClock(total)}）`}
        </button>
        {presets.length === 0 ? (
          <p className="summary">プリセットはまだありません。</p>
        ) : (
          <ul className="presets">
            {presets.map((p) => (
              <li key={p.id} className="preset">
                <button className="preset-main" onClick={() => onApply(p)}>
                  <span className="preset-name">{p.name}</span>
                  <span className="preset-meta">
                    {p.steps.map((s) => shortDuration(s.durationSec)).join(' / ')}
                    {p.rounds > 1 ? ` ×${p.rounds}` : ''} ・ {formatClock(totalDurationMs(buildSegments(p)))}
                  </span>
                </button>
                <button className="icon danger" onClick={() => onDelete(p.id)} aria-label={`${p.name}を削除`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
