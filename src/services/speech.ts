/**
 * 音声合成（読み上げ）。Web Speech API の speechSynthesis を薄く包む。
 * スマホアプリ化の際はこのファイルをネイティブ TTS 実装に差し替える想定。
 */

type Listener = (speaking: boolean) => void;

export interface SpeakOptions {
  /** 読み上げ中の発話を打ち切って即座に話す（カウントダウンなど） */
  interrupt?: boolean;
}

class SpeechService {
  enabled = true;
  rate = 1.1;
  volume = 1;
  private voice: SpeechSynthesisVoice | null = null;
  private listeners = new Set<Listener>();
  private speaking = false;
  /** 最後に読み上げが終わった時刻。音声認識が自分の声を拾わないよう判定に使う */
  lastSpokeAt = 0;

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  constructor() {
    if (!this.supported) return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      this.voice =
        voices.find((v) => v.lang === 'ja-JP' && v.localService) ??
        voices.find((v) => v.lang === 'ja-JP') ??
        voices.find((v) => v.lang.startsWith('ja')) ??
        null;
    };
    pick();
    window.speechSynthesis.addEventListener?.('voiceschanged', pick);
  }

  /** iOS Safari はユーザー操作中に一度発話しないと以後の発話がブロックされるため、ボタン押下時に呼ぶ */
  unlock(): void {
    if (!this.supported) return;
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }

  speak(text: string, opts: SpeakOptions = {}): void {
    if (!this.enabled || !this.supported || !text) return;
    const synth = window.speechSynthesis;
    if (opts.interrupt) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    if (this.voice) u.voice = this.voice;
    u.rate = this.rate;
    u.volume = this.volume;
    u.onstart = () => this.setSpeaking(true);
    u.onend = u.onerror = () => {
      this.lastSpokeAt = Date.now();
      if (!synth.speaking) this.setSpeaking(false);
    };
    this.setSpeaking(true);
    synth.speak(u);
  }

  cancel(): void {
    if (!this.supported) return;
    window.speechSynthesis.cancel();
    this.lastSpokeAt = Date.now();
    this.setSpeaking(false);
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setSpeaking(v: boolean) {
    if (this.speaking === v) return;
    this.speaking = v;
    if (!v) this.lastSpokeAt = Date.now();
    this.listeners.forEach((fn) => fn(v));
  }
}

export const speech = new SpeechService();
