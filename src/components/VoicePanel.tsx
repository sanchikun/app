import type { ListenState } from '../services/recognition';

interface Props {
  supported: boolean;
  state: ListenState;
  error?: string;
  lastHeard: string;
  lastAction: string;
  onToggle(): void;
}

const EXAMPLES = [
  '「3分タイマー」',
  '「1分30秒」',
  '「スタート」「ストップ」「再開」',
  '「リセット」「次」「戻って」',
  '「残りは？」',
  '「1分追加」',
  '「1分と30秒のインターバル 5回」',
  '「ワーク40秒 休憩20秒 8セット」',
];

export function VoicePanel({ supported, state, error, lastHeard, lastAction, onToggle }: Props) {
  const on = state === 'listening' || state === 'starting';
  return (
    <section className="panel voice">
      <div className="voice-head">
        <button
          className={`mic ${on ? 'on' : ''} ${state}`}
          onClick={onToggle}
          disabled={!supported}
          aria-pressed={on}
          aria-label={on ? '音声操作をオフ' : '音声操作をオン'}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path
              fill="currentColor"
              d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
            />
          </svg>
        </button>
        <div className="voice-status">
          <div className="voice-title">
            音声操作 {on ? (state === 'listening' ? '・聞き取り中' : '・準備中') : '・オフ'}
          </div>
          <div className="voice-detail">
            {!supported
              ? 'このブラウザは音声認識に未対応です（読み上げは使えます）'
              : error
                ? error
                : lastHeard
                  ? `「${lastHeard}」${lastAction ? ` → ${lastAction}` : ''}`
                  : 'マイクをオンにして話しかけてください'}
          </div>
        </div>
      </div>
      <details className="voice-help">
        <summary>話しかけ方の例</summary>
        <ul>
          {EXAMPLES.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
