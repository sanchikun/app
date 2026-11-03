/** ダイヤル描画の共通ジオメトリ（SVG の viewBox 座標） */
export const SIZE = 320;
export const C = SIZE / 2;
export const R_MAIN = 128;
export const STROKE = 26;
export const R_OUTER = 152;

/** 12時の位置から時計回りに frac(0..1) 進んだ点 */
export function polar(r: number, frac: number): [number, number] {
  const a = frac * 2 * Math.PI - Math.PI / 2;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

/** 12時から時計回りに from→to(0..1) の円弧（線用） */
export function arcPath(r: number, from: number, to: number): string {
  if (to - from >= 0.9999) {
    const [x, y] = polar(r, from);
    const [xm, ym] = polar(r, from + 0.5);
    return `M ${x} ${y} A ${r} ${r} 0 1 1 ${xm} ${ym} A ${r} ${r} 0 1 1 ${x} ${y}`;
  }
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  const large = to - from > 0.5 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}
