import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cue } from './core/announcer';
import type { TimerSnapshot } from './core/engine';
import { cueToSpeech, formatClock, speakDuration, statusSpeech } from './core/format';
import { lapLabel, nextLapUnit, roundsPerLap } from './core/laps';
import { intervalProgram, isSimple, newId, programLap, simpleProgram, type Program } from './core/program';
import { parseVoiceCommand, VOICE_HELP_TEXT, type VoiceCommand } from './core/voiceCommands';
import { Controls } from './components/Controls';
import { Dial } from './components/Dial';
import { DialEditor } from './components/DialEditor';
import { IntervalEditBar, SimpleEditBar } from './components/EditBar';
import { IntervalSheet } from './components/IntervalSheet';
import { PresetSheet } from './components/PresetSheet';
import { SettingsPanel } from './components/SettingsPanel';
import { useTimer } from './hooks/useTimer';
import { VoiceRecognizer, type ListenState } from './services/recognition';
import { sound } from './services/sound';
import { speech } from './services/speech';
import {
  loadEditor,
  loadPresets,
  loadSettings,
  saveEditor,
  savePresets,
  saveSettings,
  type EditorState,
  type Mode,
  type Settings,
} from './services/storage';
import { keepAwake } from './services/wakeLock';

function unlockMedia() {
  speech.unlock();
  sound.unlock();
}

const programFor = (e: EditorState): Program => (e.mode === 'simple' ? simpleProgram(e.simpleSec) : e.interval);

const clonePreset = (p: Program): Program => ({
  ...p,
  id: newId('prog'),
  steps: p.steps.map((s) => ({ ...s, id: newId('step') })),
});

type SheetKind = 'settings' | 'presets' | 'interval' | null;

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [editor, setEditor] = useState<EditorState>(loadEditor);
  const [presets, setPresets] = useState<Program[]>(loadPresets);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const editorRef = useRef(editor);

  // 設定をサービスへ反映
  useEffect(() => {
    speech.enabled = settings.voiceEnabled;
    speech.rate = settings.speechRate;
    sound.enabled = settings.soundEnabled;
    sound.vibration = settings.vibration;
    saveSettings(settings);
  }, [settings]);

  // タイマーからの合図 → 効果音 + 読み上げ
  const handleCues = useCallback((cues: Cue[], snap: TimerSnapshot) => {
    for (const cue of cues) {
      if (cue.type === 'countdown') sound.tick();
      if (cue.type === 'segment' && !cue.isFirst) sound.segment(cue.segment.kind);
      if (cue.type === 'finish') sound.finish();
      const text = cueToSpeech(cue, snap);
      // カウントダウンと切り替えは遅れると意味がないので、前の発話を打ち切る
      // （開始時の案内だけは、直前の「〜にセットしました」を遮らないよう打ち切らない）
      const interrupt =
        cue.type === 'countdown' || cue.type === 'finish' || (cue.type === 'segment' && !cue.isFirst);
      if (text) speech.speak(text, { interrupt });
    }
  }, []);

  const [snap, timer] = useTimer(programFor(editor), settings.announce, handleCues);
  // simpleProgram は呼ぶたびに id が変わるので、中身が変わったときだけ作り直す
  const program = useMemo(() => programFor(editor), [editor.mode, editor.simpleSec, editor.interval]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 編集内容を確定してタイマーに反映する。
   * 動作中・一時停止中は（force でない限り）タイマーはそのまま。
   */
  const commitEditor = useCallback(
    (next: EditorState, opts: { force?: boolean; autoStart?: boolean } = {}) => {
      editorRef.current = next;
      setEditor(next);
      saveEditor(next);
      const st = timer.current().status;
      if (opts.force || (st !== 'running' && st !== 'paused')) timer.load(programFor(next));
      if (opts.autoStart) timer.start();
    },
    [timer],
  );
  const updateEditor = useCallback(
    (fn: (e: EditorState) => EditorState, opts?: { force?: boolean; autoStart?: boolean }) =>
      commitEditor(fn(editorRef.current), opts),
    [commitEditor],
  );

  const updateInterval = (fn: (p: Program) => Program) => updateEditor((e) => ({ ...e, interval: fn(e.interval) }));
  const setStepDuration = (i: number, sec: number) =>
    updateInterval((p) => ({ ...p, steps: p.steps.map((s, j) => (j === i ? { ...s, durationSec: sec } : s)) }));

  const applyPreset = (p: Program) => {
    if (isSimple(p)) {
      updateEditor((e) => ({ ...e, mode: 'simple', simpleSec: p.steps[0].durationSec }), { force: true });
    } else {
      updateEditor((e) => ({ ...e, mode: 'interval', interval: clonePreset(p), selected: 0 }), { force: true });
    }
  };

  const savePreset = (p: Program) => {
    const preset = { ...clonePreset(p), id: newId('preset') };
    const next = [...presets, preset];
    setPresets(next);
    savePresets(next);
  };

  // 画面スリープ防止
  useEffect(() => {
    keepAwake(settings.keepAwake && snap.status === 'running');
  }, [settings.keepAwake, snap.status]);

  // タブのタイトルに残り時間を表示
  useEffect(() => {
    const label = snap.segments.length > 1 && snap.segment ? ` ${snap.segment.label}` : '';
    document.title =
      snap.status === 'idle'
        ? 'リングタイマー'
        : snap.status === 'finished'
          ? '完了 - リングタイマー'
          : `${formatClock(snap.segmentRemainingMs)}${label}`;
  }, [snap.status, snap.segmentRemainingMs, snap.segment, snap.segments.length]);

  // ---- 音声コマンド ----
  const [listenState, setListenState] = useState<ListenState>('off');
  const [toast, setToast] = useState<{ text: string; sub?: string; key: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showToast = useCallback((text: string, sub?: string) => {
    setToast({ text, sub, key: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const runCommand = useCallback(
    (cmd: VoiceCommand): string => {
      const cur = timer.current();
      switch (cmd.type) {
        case 'start':
          if (cur.status === 'running') return '動作中';
          if (cur.status === 'paused') {
            speech.speak('再開します', { interrupt: true });
            timer.start();
            return '再開';
          }
          timer.start();
          return 'スタート';
        case 'resume':
          if (cur.status === 'running') return '動作中';
          if (cur.status === 'paused') speech.speak('再開します', { interrupt: true });
          timer.start();
          return '再開';
        case 'pause':
          if (cur.status !== 'running') return '停止中';
          timer.pause();
          speech.speak('一時停止しました', { interrupt: true });
          return '一時停止';
        case 'reset':
          timer.reset();
          speech.speak('リセットしました', { interrupt: true });
          return 'リセット';
        case 'skip':
          timer.skip();
          if (timer.current().status !== 'running') speech.speak('次へ進みました', { interrupt: true });
          return '次へ';
        case 'previous':
          timer.previous();
          if (timer.current().status !== 'running') speech.speak('戻りました', { interrupt: true });
          return '戻る';
        case 'status':
          speech.speak(statusSpeech(cur), { interrupt: true });
          return '残り時間を案内';
        case 'add':
          timer.addTime(cmd.deltaSec);
          speech.speak(`${speakDuration(cmd.deltaSec * 1000)}追加しました`, { interrupt: true });
          return `${speakDuration(cmd.deltaSec * 1000)}追加`;
        case 'set': {
          if (!cmd.autoStart) speech.speak(`${speakDuration(cmd.durationSec * 1000)}にセットしました`, { interrupt: true });
          updateEditor((e) => ({ ...e, mode: 'simple', simpleSec: cmd.durationSec }), {
            force: true,
            autoStart: cmd.autoStart,
          });
          return `${speakDuration(cmd.durationSec * 1000)}${cmd.autoStart ? 'でスタート' : 'にセット'}`;
        }
        case 'interval': {
          const p = intervalProgram(cmd.workSec, cmd.restSec, cmd.rounds, {
            name: `${speakDuration(cmd.workSec * 1000)} / ${speakDuration(cmd.restSec * 1000)} ×${cmd.rounds}`,
            prepareSec: cmd.autoStart ? 5 : 0,
          });
          speech.speak(
            `ワーク${speakDuration(cmd.workSec * 1000)}、休憩${speakDuration(cmd.restSec * 1000)}を${cmd.rounds}回${cmd.autoStart ? '' : 'にセットしました'}`,
            { interrupt: true },
          );
          updateEditor((e) => ({ ...e, mode: 'interval', interval: p, selected: 0 }), {
            force: true,
            autoStart: cmd.autoStart,
          });
          return `インターバル ${speakDuration(cmd.workSec * 1000)}/${speakDuration(cmd.restSec * 1000)} ×${cmd.rounds}`;
        }
        case 'help':
          speech.speak(VOICE_HELP_TEXT, { interrupt: true });
          return 'ヘルプ';
      }
    },
    [timer, updateEditor],
  );

  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const recognizer = useMemo(
    () =>
      new VoiceRecognizer({
        onResult: (alts) => {
          for (const alt of alts) {
            const cmd = parseVoiceCommand(alt);
            if (cmd) {
              showToastRef.current(`「${alt}」`, runCommandRef.current(cmd));
              return;
            }
          }
          showToastRef.current(`「${alts[0] ?? ''}」`, 'コマンドとして認識できませんでした');
        },
        onStateChange: (state, detail) => {
          setListenState(state);
          if (state === 'error' && detail) showToastRef.current(detail);
        },
      }),
    [],
  );
  useEffect(() => () => recognizer.stop(), [recognizer]);

  const listening = listenState === 'listening' || listenState === 'starting';
  const toggleListening = () => {
    unlockMedia();
    if (listening) {
      recognizer.stop();
      showToast('音声操作をオフにしました');
    } else {
      recognizer.start();
      showToast('話しかけてください', '例: 「3分タイマー」「ストップ」「残りは？」');
    }
  };

  // ---- キーボード操作（PC 用） ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        unlockMedia();
        timer.toggle();
      } else if (e.key === 'r') timer.reset();
      else if (e.key === 'n' || e.key === 'ArrowRight') timer.skip();
      else if (e.key === 'p' || e.key === 'ArrowLeft') timer.previous();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [timer]);

  const toggleTimer = () => {
    unlockMedia();
    timer.toggle();
  };

  const idle = snap.status === 'idle';
  // 動作中だけはモードを切り替えられない（誤タップで止まらないように）。一時停止中なら切り替えると最初からになる
  const locked = snap.status === 'running';
  const switchMode = (mode: Mode) => {
    if (mode === editorRef.current.mode) return;
    if (snap.status === 'paused') speech.cancel();
    updateEditor((e) => ({ ...e, mode }), { force: true });
  };
  const endAt = new Date(Date.now() + snap.totalRemainingMs);

  return (
    <div className={`app status-${snap.status} kind-${idle ? 'work' : (snap.segment?.kind ?? 'work')}`}>
      <header className="app-header">
        <button
          className={`icon mic-mini ${listening ? 'on' : ''}`}
          onClick={toggleListening}
          disabled={!VoiceRecognizer.supported}
          aria-pressed={listening}
          aria-label={listening ? '音声操作をオフ' : '音声操作をオン'}
          title="音声操作"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <path
              fill="currentColor"
              d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
            />
          </svg>
        </button>
        <div className="mode-switch" role="tablist" aria-label="モード">
          {(
            [
              ['simple', 'タイマー'],
              ['interval', 'インターバル'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={editor.mode === m}
              className={editor.mode === m ? 'active' : ''}
              disabled={locked && editor.mode !== m}
              onClick={() => switchMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="header-actions">
          <button className="icon" onClick={() => setSheet('presets')} aria-label="プリセット" title="プリセット">
            ☰
          </button>
          <button className="icon" onClick={() => setSheet('settings')} aria-label="設定" title="設定">
            ⚙
          </button>
        </div>
      </header>

      <div className="dial-area">
        {toast && (
          <div className="toast" key={toast.key} role="status">
            <div>{toast.text}</div>
            {toast.sub && <div className="toast-sub">{toast.sub}</div>}
          </div>
        )}
        {idle ? (
          <DialEditor
            mode={editor.mode}
            steps={program.steps}
            selected={editor.selected}
            rounds={program.rounds}
            lapRounds={roundsPerLap(programLap(program), program.rounds)}
            lapName={lapLabel(programLap(program), program.rounds)}
            skipLastRest={program.skipLastRest}
            programTotalSec={Math.round(snap.totalMs / 1000)}
            style={settings.dialStyle}
            onSelect={(i) => updateEditor((e) => ({ ...e, selected: i }))}
            onChange={(i, sec) =>
              editorRef.current.mode === 'simple'
                ? updateEditor((e) => ({ ...e, simpleSec: sec }))
                : setStepDuration(i, sec)
            }
            onCenterTap={toggleTimer}
            onDetent={() => sound.vibrate([4])}
          />
        ) : (
          <Dial snap={snap} style={settings.dialStyle} lap={programLap(program)} onTap={toggleTimer} />
        )}
      </div>

      <div className="bottom">
        <div className="bottom-slot">
          {idle ? (
            editor.mode === 'simple' ? (
              <SimpleEditBar sec={editor.simpleSec} onChange={(sec) => updateEditor((e) => ({ ...e, simpleSec: sec }))} />
            ) : (
              <IntervalEditBar
                program={editor.interval}
                selected={editor.selected}
                onSelect={(i) => updateEditor((e) => ({ ...e, selected: i }))}
                onDuration={setStepDuration}
                onToggleKind={(i) =>
                  updateInterval((p) => ({
                    ...p,
                    steps: p.steps.map((s, j) => {
                      if (j !== i) return s;
                      const kind = s.kind === 'rest' ? 'work' : 'rest';
                      // 既定の名前のままなら名前も切り替える
                      const label =
                        s.label === 'ワーク' || s.label === '休憩' ? (kind === 'rest' ? '休憩' : 'ワーク') : s.label;
                      return { ...s, kind, label };
                    }),
                  }))
                }
                onRounds={(n) => updateInterval((p) => ({ ...p, rounds: n }))}
                onOpenDetail={() => setSheet('interval')}
                lapName={lapLabel(programLap(editor.interval), editor.interval.rounds)}
                onCycleLap={() => updateInterval((p) => ({ ...p, lap: nextLapUnit(programLap(p), p.rounds) }))}
              />
            )
          ) : (
            <div className="run-info">
              <span className="run-name">{program.name}</span>
              {snap.status !== 'finished' && (
                <span>
                  終了予定 {String(endAt.getHours()).padStart(2, '0')}:{String(endAt.getMinutes()).padStart(2, '0')}
                </span>
              )}
            </div>
          )}
        </div>
        <Controls
          snap={snap}
          onToggle={toggleTimer}
          onReset={timer.reset}
          onSkip={timer.skip}
          onPrevious={timer.previous}
          onAdd={timer.addTime}
        />
      </div>

      {sheet === 'settings' && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setSheet(null)}
          onTestVoice={() => {
            unlockMedia();
            speech.rate = settings.speechRate;
            speech.speak('残り30秒。ワーク、1分', { interrupt: true });
          }}
        />
      )}
      {sheet === 'presets' && (
        <PresetSheet
          presets={presets}
          current={program}
          onApply={(p) => {
            applyPreset(p);
            setSheet(null);
          }}
          onSave={savePreset}
          onDelete={(id) => {
            const next = presets.filter((p) => p.id !== id);
            setPresets(next);
            savePresets(next);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'interval' && (
        <IntervalSheet
          program={editor.interval}
          onChange={(p) =>
            updateEditor((e) => ({ ...e, interval: p, selected: Math.min(e.selected, p.steps.length - 1) }))
          }
          onSavePreset={savePreset}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
