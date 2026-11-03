import type { TimerSnapshot } from '../core/engine';

interface Props {
  snap: TimerSnapshot;
  onToggle(): void;
  onReset(): void;
  onSkip(): void;
  onPrevious(): void;
  onAdd(sec: number): void;
}

export function Controls({ snap, onToggle, onReset, onSkip, onPrevious, onAdd }: Props) {
  const multi = snap.segments.length > 1;
  const running = snap.status === 'running';
  const label = running ? '一時停止' : snap.status === 'paused' ? '再開' : snap.status === 'finished' ? 'もう一度' : 'スタート';
  return (
    <div className="controls">
      <div className="controls-row">
        <button className="btn round ghost" onClick={onReset} aria-label="リセット" title="リセット">
          ↺
        </button>
        {multi && (
          <button className="btn round ghost" onClick={onPrevious} aria-label="前へ" title="前の区間へ">
            ⏮
          </button>
        )}
        <button className={`btn round primary ${running ? 'is-running' : ''}`} onClick={onToggle} aria-label={label}>
          {running ? '❚❚' : '▶'}
        </button>
        {multi ? (
          <button className="btn round ghost" onClick={onSkip} aria-label="次へ" title="次の区間へ">
            ⏭
          </button>
        ) : null}
        <button className="btn round ghost small-text" onClick={() => onAdd(60)} aria-label="1分追加" title="1分追加">
          +1分
        </button>
      </div>
      <div className="controls-caption">{label}</div>
    </div>
  );
}
