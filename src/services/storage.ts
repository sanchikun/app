import { defaultAnnounceSettings, type AnnounceSettings } from '../core/announcer';
import { intervalProgram, makeStep, newId, type Program } from '../core/program';

export type DialStyle = 'ring' | 'pie';

export interface Settings {
  voiceEnabled: boolean;
  speechRate: number;
  soundEnabled: boolean;
  vibration: boolean;
  keepAwake: boolean;
  dialStyle: DialStyle;
  announce: AnnounceSettings;
}

export const defaultSettings: Settings = {
  voiceEnabled: true,
  speechRate: 1.1,
  soundEnabled: true,
  vibration: true,
  keepAwake: true,
  dialStyle: 'ring',
  announce: defaultAnnounceSettings,
};

const KEY_SETTINGS = 'vrt.settings.v1';
const KEY_PRESETS = 'vrt.presets.v1';
const KEY_EDITOR = 'vrt.editor.v1';
/** 「最後の休憩を省略」を既定オフに変えたときの一度きりの移行済みフラグ */
const KEY_MIGRATED_REST = 'vrt.migrated.keepLastRest';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // プライベートモード等で保存できなくても動作は続ける
  }
}

export function loadSettings(): Settings {
  const saved = read<Partial<Settings>>(KEY_SETTINGS);
  return {
    ...defaultSettings,
    ...saved,
    announce: { ...defaultAnnounceSettings, ...saved?.announce },
  };
}

export const saveSettings = (s: Settings) => write(KEY_SETTINGS, s);

export function builtinPresets(): Program[] {
  const tabata = intervalProgram(20, 10, 8, { name: 'タバタ式 (20秒/10秒×8)', prepareSec: 10 });
  const basic = intervalProgram(60, 30, 5, { name: '1分 / 30秒 ×5', prepareSec: 5 });
  const pomodoro = intervalProgram(25 * 60, 5 * 60, 4, { name: 'ポモドーロ (25分/5分×4)' });
  pomodoro.steps[0].label = '集中';
  const stretch: Program = {
    id: newId('prog'),
    name: 'ストレッチ (左右30秒×3)',
    steps: [makeStep('右', 30, 'work'), makeStep('切り替え', 5, 'rest'), makeStep('左', 30, 'work'), makeStep('休憩', 10, 'rest')],
    rounds: 3,
    prepareSec: 5,
    skipLastRest: false,
  };
  return [basic, tabata, pomodoro, stretch].map((p, i) => ({ ...p, id: `builtin-${i}` }));
}

/**
 * 以前は「最後のラウンドの休憩を省略」が既定オンだった。
 * ×2 にするとワークが連続して見えて分かりにくいため既定オフに変更し、
 * 既に保存されている編集中のインターバルと内蔵プリセットも一度だけオフに揃える。
 */
function migrateKeepLastRest() {
  if (read<boolean>(KEY_MIGRATED_REST)) return;
  const presets = read<Program[]>(KEY_PRESETS);
  if (presets) {
    write(
      KEY_PRESETS,
      presets.map((p) => (p.id.startsWith('builtin-') ? { ...p, skipLastRest: false } : p)),
    );
  }
  const editor = read<EditorState>(KEY_EDITOR);
  if (editor?.interval) write(KEY_EDITOR, { ...editor, interval: { ...editor.interval, skipLastRest: false } });
  write(KEY_MIGRATED_REST, true);
}

export function loadPresets(): Program[] {
  migrateKeepLastRest();
  return read<Program[]>(KEY_PRESETS) ?? builtinPresets();
}

export const savePresets = (p: Program[]) => write(KEY_PRESETS, p);

export type Mode = 'simple' | 'interval';

/** 画面で編集中の内容（モードごとに保持して、切り替えても失われないように） */
export interface EditorState {
  mode: Mode;
  simpleSec: number;
  interval: Program;
  /** インターバルで選択中の区間 */
  selected: number;
}

export function defaultEditor(): EditorState {
  return {
    mode: 'simple',
    simpleSec: 180,
    interval: { ...intervalProgram(60, 30, 5, { prepareSec: 5 }), name: 'インターバル' },
    selected: 0,
  };
}

export function loadEditor(): EditorState {
  migrateKeepLastRest();
  const saved = read<Partial<EditorState>>(KEY_EDITOR);
  const base = defaultEditor();
  if (!saved) return base;
  const interval = saved.interval?.steps?.length ? saved.interval : base.interval;
  return {
    mode: saved.mode === 'interval' ? 'interval' : 'simple',
    simpleSec: typeof saved.simpleSec === 'number' ? saved.simpleSec : base.simpleSec,
    interval,
    selected: Math.min(Math.max(0, saved.selected ?? 0), interval.steps.length - 1),
  };
}

export const saveEditor = (e: EditorState) => write(KEY_EDITOR, e);
