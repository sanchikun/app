/**
 * 設定用ダイヤル（円グラフ）の目盛り計算。
 *
 * ダイヤル1周が何秒にあたるか（スケール）を、設定時間に合わせて自動で切り替える。
 * 例: 3分なら「1周=5分」、1分+30秒のインターバルなら「1周=2分」。
 */

/** 1周あたりの秒数の候補 */
export const SCALE_LEVELS = [60, 120, 300, 600, 900, 1800, 3600, 5400, 7200, 10800] as const;

export const MAX_TOTAL_SEC = 10800;

/** スケールごとのドラッグ時のスナップ幅（秒） */
const SNAP: Record<number, number> = {
  60: 5,
  120: 5,
  300: 15,
  600: 30,
  900: 30,
  1800: 60,
  3600: 60,
  5400: 300,
  7200: 300,
  10800: 300,
};

/** 合計 total 秒が 1周の 90% 以内に収まる最小のスケール */
export function fitScale(totalSec: number, minScale = 60): number {
  for (const level of SCALE_LEVELS) {
    if (level < minScale) continue;
    if (totalSec <= level * 0.9) return level;
  }
  return SCALE_LEVELS[SCALE_LEVELS.length - 1];
}

/** total が今のスケールからはみ出したときだけ広げる（ドラッグ中用。縮めはしない） */
export function expandScale(scale: number, totalSec: number): number {
  if (totalSec <= scale) return scale;
  for (const level of SCALE_LEVELS) if (level >= totalSec) return level;
  return SCALE_LEVELS[SCALE_LEVELS.length - 1];
}

export function snapFor(scale: number): number {
  return SNAP[scale] ?? Math.max(1, Math.round(scale / 120));
}

export function snap(sec: number, step: number): number {
  return Math.round(sec / step) * step;
}

/** −/＋ボタンでの微調整幅。短い時間ほど細かく */
export function fineStep(sec: number, direction: 1 | -1): number {
  // 減らす方向は「減らした後の値」の刻みで考える（1:00 → 0:55 のように）
  const v = direction > 0 ? sec : sec - 1;
  if (v < 60) return 5;
  if (v < 300) return 15;
  if (v < 1200) return 30;
  if (v < 3600) return 60;
  return 300;
}

/** 現在値を微調整幅の倍数に揃えながら1段階動かす */
export function nudge(sec: number, direction: 1 | -1, min = 0, max = MAX_TOTAL_SEC): number {
  const step = fineStep(sec, direction);
  const aligned = direction > 0 ? Math.floor(sec / step) * step + step : Math.ceil(sec / step) * step - step;
  return Math.min(max, Math.max(min, aligned));
}

/**
 * 角度の差分（0..1 の周回比率）を -0.5..0.5 に正規化する。
 * 12時をまたいでドラッグしたときに値が飛ばないようにするため。
 */
export function unwrapDelta(prev: number, next: number): number {
  let d = next - prev;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

/** 中心 (cx, cy) から見た点の角度を、12時=0・時計回りで 0..1 にして返す */
export function angleFrac(cx: number, cy: number, x: number, y: number): number {
  const a = Math.atan2(x - cx, -(y - cy)); // 12時=0, 時計回りが正
  const f = a / (2 * Math.PI);
  return f < 0 ? f + 1 : f;
}

/** 目盛りラベル（例: 120秒スケールの1/4 → 「0:30」, 3600秒スケールの1/4 → 「15分」） */
export function scaleLabel(sec: number, scale: number): string {
  const total = Math.round(sec);
  const clock = (v: number) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
  if (scale < 600) return clock(total);
  if (total >= 3600) {
    if (total % 3600 === 0) return `${total / 3600}時間`;
    const m = Math.round((total % 3600) / 60);
    return `${Math.floor(total / 3600)}:${String(m).padStart(2, '0')}`;
  }
  // 15分スケールの 1/4 = 3:45 のように分で割り切れないときは m:ss
  return total % 60 === 0 ? `${total / 60}分` : clock(total);
}
