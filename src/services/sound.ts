/**
 * 効果音（Web Audio API で生成するのでファイル不要）とバイブレーション。
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

export const sound = {
  enabled: true,
  vibration: true,

  /** ユーザー操作中に呼んで AudioContext を有効化する（モバイルブラウザ対策） */
  unlock(): void {
    const c = getCtx();
    if (c && c.state === 'suspended') void c.resume();
  },

  beep(freq = 880, durationMs = 120, volume = 0.25, delayMs = 0): void {
    if (!this.enabled) return;
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime + delayMs / 1000;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + durationMs / 1000 + 0.02);
  },

  /** カウントダウンの「ピッ」 */
  tick(): void {
    this.beep(880, 110, 0.22);
  },

  /** 区間切り替えの「ピーッ」 */
  segment(kind: 'work' | 'rest' | 'prepare'): void {
    const f = kind === 'rest' ? 660 : 1175;
    this.beep(f, 380, 0.3);
    this.vibrate([180]);
  },

  /** 終了のチャイム */
  finish(): void {
    [0, 180, 360].forEach((d, i) => this.beep([1047, 1319, 1568][i], 260, 0.3, d));
    this.beep(2093, 700, 0.25, 560);
    this.vibrate([300, 120, 300, 120, 500]);
  },

  vibrate(pattern: number[]): void {
    if (!this.vibration) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  },
};
