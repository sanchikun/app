import type { AnnounceSettings } from '../core/announcer';
import type { Settings } from '../services/storage';

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
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="設定" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>設定</h2>
          <button className="icon" onClick={onClose} aria-label="閉じる">✕</button>
        </div>

        <h3>表示</h3>
        <div className="segmented">
          {(['ring', 'pie'] as const).map((s) => (
            <button key={s} className={settings.dialStyle === s ? 'active' : ''} onClick={() => set({ dialStyle: s })}>
              {s === 'ring' ? 'リング' : 'パイ（円グラフ）'}
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
      </div>
    </div>
  );
}
