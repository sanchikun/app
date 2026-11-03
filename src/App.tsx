import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cue } from './core/announcer';
import type { TimerSnapshot } from './core/engine';
import { cueToSpeech, formatClock, speakDuration, statusSpeech } from './core/format';
import { intervalProgram, simpleProgram, type Program } from './core/program';
import { parseVoiceCommand, VOICE_HELP_TEXT, type VoiceCommand } from './core/voiceCommands';
import { Controls } from './components/Controls';
import { Dial } from './components/Dial';
import { SettingsPanel } from './components/SettingsPanel';
import { SetupPanel } from './components/SetupPanel';
import { VoicePanel } from './components/VoicePanel';
import { useTimer } from './hooks/useTimer';
import { VoiceRecognizer, type ListenState } from './services/recognition';
import { sound } from './services/sound';
import { speech } from './services/speech';
import {
  loadLastProgram,
  loadPresets,
  loadSettings,
  saveLastProgram,
  savePresets,
  saveSettings,
  type Settings,
} from './services/storage';
import { keepAwake } from './services/wakeLock';

function unlockMedia() {
  speech.unlock();
  sound.unlock();
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [program, setProgram] = useState<Program>(() => loadLastProgram() ?? simpleProgram(180));
  const [presets, setPresets] = useState<Program[]>(loadPresets);
  const [showSettings, setShowSettings] = useState(false);

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

  const [snap, timer] = useTimer(program, settings.announce, handleCues);

  const applyProgram = useCallback(
    (p: Program, autoStart: boolean) => {
      timer.load(p);
      setProgram(p);
      saveLastProgram(p);
      if (autoStart) timer.start();
    },
    [timer],
  );

  // 画面スリープ防止
  useEffect(() => {
    keepAwake(settings.keepAwake && snap.status === 'running');
  }, [settings.keepAwake, snap.status]);

  // タブのタイトルに残り時間を表示
  useEffect(() => {
    const label = snap.segments.length > 1 && snap.segment ? ` ${snap.segment.label}` : '';
    document.title =
      snap.status === 'idle' ? 'リングタイマー' : snap.status === 'finished' ? '完了 - リングタイマー' : `${formatClock(snap.segmentRemainingMs)}${label}`;
  }, [snap.status, snap.segmentRemainingMs, snap.segment, snap.segments.length]);

  // ---- 音声コマンド ----
  const [listenState, setListenState] = useState<ListenState>('off');
  const [listenError, setListenError] = useState<string>();
  const [lastHeard, setLastHeard] = useState('');
  const [lastAction, setLastAction] = useState('');

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
          const p = simpleProgram(cmd.durationSec);
          if (!cmd.autoStart) speech.speak(`${speakDuration(cmd.durationSec * 1000)}にセットしました`, { interrupt: true });
          applyProgram(p, cmd.autoStart);
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
          applyProgram(p, cmd.autoStart);
          return `インターバル ${speakDuration(cmd.workSec * 1000)}/${speakDuration(cmd.restSec * 1000)} ×${cmd.rounds}`;
        }
        case 'help':
          speech.speak(VOICE_HELP_TEXT, { interrupt: true });
          return 'ヘルプ';
      }
    },
    [timer, applyProgram],
  );

  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;

  const recognizer = useMemo(
    () =>
      new VoiceRecognizer({
        onResult: (alts) => {
          setLastHeard(alts[0] ?? '');
          for (const alt of alts) {
            const cmd = parseVoiceCommand(alt);
            if (cmd) {
              setLastHeard(alt);
              setLastAction(runCommandRef.current(cmd));
              return;
            }
          }
          setLastAction('（コマンドとして認識できませんでした）');
        },
        onStateChange: (state, detail) => {
          setListenState(state);
          setListenError(state === 'error' ? detail : undefined);
        },
      }),
    [],
  );
  useEffect(() => () => recognizer.stop(), [recognizer]);

  const toggleListening = () => {
    unlockMedia();
    if (listenState === 'listening' || listenState === 'starting') {
      recognizer.stop();
    } else {
      recognizer.start();
    }
  };

  // ---- キーボード操作（PC 試作用） ----
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

  return (
    <div className={`app status-${snap.status} kind-${snap.segment?.kind ?? 'work'}`}>
      <header className="app-header">
        <h1>リングタイマー</h1>
        <div className="header-actions">
          <button
            className={`icon mic-mini ${listenState === 'listening' ? 'on' : ''}`}
            onClick={toggleListening}
            disabled={!VoiceRecognizer.supported}
            aria-label="音声操作の切り替え"
            title="音声操作"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path
                fill="currentColor"
                d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
              />
            </svg>
          </button>
          <button className="icon" onClick={() => setShowSettings(true)} aria-label="設定" title="設定">
            ⚙
          </button>
        </div>
      </header>

      <main>
        <div className="program-name">{program.name}</div>
        <Dial snap={snap} style={settings.dialStyle} onTap={toggleTimer} />
        <Controls
          snap={snap}
          onToggle={toggleTimer}
          onReset={timer.reset}
          onSkip={timer.skip}
          onPrevious={timer.previous}
          onAdd={timer.addTime}
        />

        <VoicePanel
          supported={VoiceRecognizer.supported}
          state={listenState}
          error={listenError}
          lastHeard={lastHeard}
          lastAction={lastAction}
          onToggle={toggleListening}
        />

        <SetupPanel
          key={program.id}
          program={program}
          presets={presets}
          onApply={(p, autoStart) => {
            if (autoStart) unlockMedia();
            applyProgram(p, autoStart);
          }}
          onSavePreset={(p) => {
            const next = [...presets, p];
            setPresets(next);
            savePresets(next);
          }}
          onDeletePreset={(id) => {
            const next = presets.filter((p) => p.id !== id);
            setPresets(next);
            savePresets(next);
          }}
        />
      </main>

      <footer className="app-footer">Space: 開始/一時停止 ・ R: リセット ・ ←/→: 前/次の区間</footer>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
          onTestVoice={() => {
            unlockMedia();
            speech.rate = settings.speechRate;
            speech.speak('残り30秒。ワーク、1分', { interrupt: true });
          }}
        />
      )}
    </div>
  );
}
