import type { TimerSnapshot } from '../core/engine';

interface Props {
  snap: TimerSnapshot;
  onToggle(): void;
  onReset(): void;
  onSkip(): void;
  onPrevious(): void;
  onAdd(sec: number): void;
}

/** 下部の操作ボタン（5枠固定で、状態によって中身だけ変えるのでレイアウトが動かない） */
export function Controls({ snap, onToggle, onReset, onSkip, onPrevious, onAdd }: Props) {
  const multi = snap.segments.length > 1;
  const idle = snap.status === 'idle';
  const running = snap.status === 'running';
  const label = running ? '一時停止' : snap.status === 'paused' ? '再開' : snap.status === 'finished' ? 'もう一度' : 'スタート';
  const empty = <span className="slot" aria-hidden />;
  return (
    <div className="controls">
      {idle ? (
        empty
      ) : (
        <button className="btn round ghost" onClick={onReset} aria-label="リセット" title="リセット（設定に戻る）">
          ↺
        </button>
      )}
      {multi && !idle ? (
        <button className="btn round ghost" onClick={onPrevious} aria-label="前へ" title="前の区間へ">
          ⏮
        </button>
      ) : (
        empty
      )}
      <button
        className={`btn round primary ${running ? 'is-running' : ''}`}
        onClick={onToggle}
        disabled={snap.totalMs <= 0}
        aria-label={label}
        title={label}
      >
        {running ? '❚❚' : snap.status === 'finished' ? '↻' : '▶'}
      </button>
      {multi && !idle ? (
        <button className="btn round ghost" onClick={onSkip} aria-label="次へ" title="次の区間へ">
          ⏭
        </button>
      ) : (
        empty
      )}
      {idle ? (
        empty
      ) : (
        <button className="btn round ghost small-text" onClick={() => onAdd(60)} aria-label="1分追加" title="1分追加">
          +1分
        </button>
      )}
    </div>
  );
}
