import type { AnnounceSettings } from '../core/announcer';
import type { Settings } from '../services/storage';
import { Sheet } from './Sheet';

const VOICE_EXAMPLES = [
  '「3分タイマー」「1分半」「5分にセットして」',
  '「スタート」「ストップ」「再開」「リセット」',
  '「次」「戻って」「残りは？」「1分追加」',
  '「1分と30秒のインターバル 5回」',
  '「ワーク40秒 休憩20秒 8セット」',
];

interface Props {
  settings: Settings;
  onChange(s: Settings): void;
  onClose(): void;
  onTestVoice(): void;
}

export function SettingsPanel({ settings, onChange, onClose, onTestVoice }: Props) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const setA = (patch: Partial<AnnounceSettings>) => set({ announce: { ...settings.announce, ...patch } });
  const a = settings.announce;

  const toggle = (label: string, checked: boolean, onToggle: (v: boolean) => void, disabled = false) => (
    <label className={`check ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <Sheet title="設定" onClose={onClose}>

        <h3>表示</h3>
        <div className="segmented">
          {(['ring', 'bar'] as const).map((s) => (
            <button key={s} className={settings.dialStyle === s ? 'active' : ''} onClick={() => set({ dialStyle: s })}>
              {s === 'ring' ? '円（リング）' : 'バー（左→右）'}
            </button>
          ))}
        </div>
        {toggle('動作中は画面をスリープさせない', settings.keepAwake, (v) => set({ keepAwake: v }))}

        <h3>音</h3>
        {toggle('音声で読み上げる', settings.voiceEnabled, (v) => set({ voiceEnabled: v }))}
        <label className="field inline">
          <span>読み上げ速度</span>
          <input
            type="range"
            min={0.7}
            max={1.6}
            step={0.1}
            value={settings.speechRate}
            onChange={(e) => set({ speechRate: Number(e.target.value) })}
          />
          <span className="value">{settings.speechRate.toFixed(1)}x</span>
          <button className="btn small" onClick={onTestVoice}>試聴</button>
        </label>
        {toggle('効果音（ピッ）', settings.soundEnabled, (v) => set({ soundEnabled: v }))}
        {toggle('バイブレーション（対応端末）', settings.vibration, (v) => set({ vibration: v }))}

        <h3>読み上げるタイミング</h3>
        {toggle('区間の開始（ワーク / 休憩の切り替え）', a.segmentStart, (v) => setA({ segmentStart: v }))}
        {toggle('半分経過', a.halfway, (v) => setA({ halfway: v }))}
        {toggle('残り時間を毎分', a.everyMinute, (v) => setA({ everyMinute: v }))}
        {toggle('残り1分', a.lastMinute || a.everyMinute, (v) => setA({ lastMinute: v }), a.everyMinute)}
        {toggle('残り30秒', a.last30, (v) => setA({ last30: v }))}
        {toggle('残り10秒', a.last10, (v) => setA({ last10: v }))}
        <label className="field inline">
          <span>最後のカウントダウン</span>
          <select value={a.countdown} onChange={(e) => setA({ countdown: Number(e.target.value) })}>
            {[0, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'なし' : `${n}秒前から`}
              </option>
            ))}
          </select>
        </label>

        <h3>話しかけ方（マイクをオンにして）</h3>
        <ul className="help-list">
          {VOICE_EXAMPLES.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>

        <h3>ダイヤルの使い方</h3>
        <ul className="help-list">
          <li>タイマー: 止まっているときに円（バー）をなぞる／白いつまみを動かすと時間を設定できます</li>
          <li>インターバル: 円（バー）全体がトレーニング全体です。まず下の「合計」で全体の時間を決め、区間の境目のつまみを動かしてワークと休憩の割合を決めます（合計は変わりません）</li>
          <li>「＋休憩」で選択中のワークの途中に休憩を追加、🗑 で選択中の区間を削除（時間は隣の区間へ）</li>
          <li>「×N」は合計時間をN回のサイクルに分けます（配分は全サイクル共通）</li>
          <li>選択中の区間ボタンをもう一度タップすると、ワーク / 休憩 が切り替わります</li>
          <li>円の中央をタップでスタート / 一時停止</li>
          <li>PC: Space 開始/一時停止 ・ R リセット ・ ←/→ 前/次の区間</li>
        </ul>
    </Sheet>
  );
}
