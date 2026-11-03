/**
 * 音声認識。Web Speech API の SpeechRecognition（Chrome/Edge/Safari）を包む。
 * スマホアプリ化の際はネイティブの音声認識プラグインに差し替える想定で、
 * 外部には「認識した文字列を onResult で渡す」だけのインターフェースにしている。
 */

import { speech } from './speech';

// lib.dom に型が無い環境向けの最小限の型定義
interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type ListenState = 'off' | 'starting' | 'listening' | 'error';

export interface RecognitionCallbacks {
  /** 確定した認識結果（候補を信頼度順に） */
  onResult: (alternatives: string[]) => void;
  onStateChange?: (state: ListenState, detail?: string) => void;
}

/** 読み上げ終了後、この時間内に届いた認識結果は自分の声とみなして捨てる */
const ECHO_GUARD_MS = 700;

export class VoiceRecognizer {
  private rec: Recognition | null = null;
  private wanted = false;
  private state: ListenState = 'off';
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private readonly cb: RecognitionCallbacks;

  constructor(cb: RecognitionCallbacks) {
    this.cb = cb;
  }

  static get supported(): boolean {
    return getCtor() !== null;
  }

  start(): void {
    const Ctor = getCtor();
    if (!Ctor) {
      this.setState('error', 'このブラウザは音声認識に対応していません（Chrome / Edge / Safari を使ってください）');
      return;
    }
    this.wanted = true;
    this.failures = 0;
    this.spawn(Ctor);
  }

  stop(): void {
    this.wanted = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const rec = this.rec;
    this.rec = null;
    rec?.abort();
    this.setState('off');
  }

  private spawn(Ctor: RecognitionCtor) {
    const rec = new Ctor();
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.onstart = () => {
      this.failures = 0;
      this.setState('listening');
    };
    rec.onresult = (e) => {
      // タイマー自身の読み上げを拾ってしまうのを防ぐ
      if (speech.isSpeaking() || Date.now() - speech.lastSpokeAt < ECHO_GUARD_MS) return;
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (!r.isFinal) continue;
        const alts: string[] = [];
        for (let j = 0; j < r.length; j += 1) alts.push(r[j].transcript);
        this.cb.onResult(alts);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.wanted = false;
        this.setState('error', 'マイクの使用が許可されていません');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.failures += 1;
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      // continuous でもブラウザは数十秒〜数分で認識を止めるので、望まれている間は再起動する
      if (this.wanted && this.failures < 5) {
        this.setState('starting');
        this.restartTimer = setTimeout(() => this.wanted && this.spawn(Ctor), 250 * (this.failures + 1));
      } else if (this.wanted) {
        this.wanted = false;
        this.setState('error', '音声認識が繰り返し停止しました');
      } else {
        this.setState('off');
      }
    };
    this.rec = rec;
    this.setState('starting');
    try {
      rec.start();
    } catch {
      // 既に開始済みなどの例外は onend 側の再起動に任せる
    }
  }

  private setState(state: ListenState, detail?: string) {
    if (this.state === state && !detail) return;
    this.state = state;
    this.cb.onStateChange?.(state, detail);
  }
}
