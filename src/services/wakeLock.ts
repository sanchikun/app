/**
 * タイマー動作中に画面が消えないようにする（Screen Wake Lock API）。
 * 非対応ブラウザでは何もしない。
 */

interface Sentinel {
  release(): Promise<void>;
  released: boolean;
}

let sentinel: Sentinel | null = null;
let wanted = false;

async function acquire() {
  const nav = navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };
  if (!nav.wakeLock || sentinel) return;
  try {
    sentinel = await nav.wakeLock.request('screen');
    (sentinel as unknown as EventTarget).addEventListener?.('release', () => {
      sentinel = null;
    });
  } catch {
    sentinel = null;
  }
}

if (typeof document !== 'undefined') {
  // タブが裏に回ると自動解除されるので、戻ってきたら取り直す
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') void acquire();
  });
}

export function keepAwake(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else if (sentinel) {
    void sentinel.release();
    sentinel = null;
  }
}
