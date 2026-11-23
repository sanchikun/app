/**
 * 米国の半導体指数（SOX）が大きく動いた翌日の、日本の半導体株の場中（寄り→引け）。
 * 「米国が大きく上げた翌日は日本が場中に垂れる」が、業種を絞るとはっきり出るかを見る。
 *   npx tsx scripts/lab-sox.ts
 */
import { ETFS, build, tester } from "./lab";
const SEMI = ["8035.T", "6857.T", "6146.T", "6920.T", "7735.T", "6723.T", "6526.T", "4063.T", "6963.T", "3436.T", "7729.T", "6525.T", "6323.T", "4062.T", "6966.T"];
const u = build((s) => !ETFS.includes(s));
const have = new Set(u.recs.map((r) => r.s));
console.log("半導体株:", SEMI.filter((s) => have.has(s)).join(" "));
const T = tester(u);
const semi = (r: { s: string }) => SEMI.includes(r.s);
for (const [name, cond] of [
  ["SOX +3%以上", (r: any) => r.sox >= 0.03], ["SOX +2〜3%", (r: any) => r.sox >= 0.02 && r.sox < 0.03], ["SOX -2〜-3%", (r: any) => r.sox <= -0.02 && r.sox > -0.03], ["SOX -3%以下", (r: any) => r.sox <= -0.03],
  ["SOX がS&Pより +2%以上強い", (r: any) => r.sox - r.us >= 0.02], ["SOX がS&Pより -2%以上弱い", (r: any) => r.sox - r.us <= -0.02],
  ["SOX +3%以上 かつ 半導体が+2%以上で寄る", (r: any) => r.sox >= 0.03 && r.gap >= 0.02], ["SOX -3%以下 かつ 半導体が-2%以下で寄る", (r: any) => r.sox <= -0.03 && r.gap <= -0.02],
  ["SOX +3%以上なのに寄りが+1%未満", (r: any) => r.sox >= 0.03 && r.gap < 0.01], ["SOX -3%以下なのに寄りが-1%より上", (r: any) => r.sox <= -0.03 && r.gap > -0.01],
] as const) {
  T(`${name} 半導体`, "intra", (r) => semi(r) && cond(r));
  T(`${name} それ以外`, "intra", (r) => !semi(r) && cond(r));
  T(`${name} 半導体の夜間`, "on", (r) => semi(r) && cond(r));
}
