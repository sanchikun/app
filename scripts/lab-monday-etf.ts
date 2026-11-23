/**
 * 月曜の引け→火曜の寄りを、ETF ごとに比べる（米国が休みの月曜は除く。本番の設定と同じ）。
 *   npx tsx scripts/lab-fetch.ts && npx tsx scripts/lab-monday-etf.ts
 */
import { readFileSync } from "node:fs";
import type { DailyBar } from "../src/core/gapstudy";
import { usMarketClosed } from "../src/core/market";
import { CACHE, f, stat } from "./lab";

const NAMES: Record<string, string> = { "1306.T": "TOPIX連動", "1321.T": "日経225連動", "1570.T": "日経レバレッジ（2倍）", "1343.T": "東証REIT", "2516.T": "東証グロース250", "1357.T": "日経ダブルインバース（参考）" };
const PER: [string, string][] = [["2017", "2020"], ["2020", "2023"], ["2023", "2099"]];
console.log("月曜の引けで買い、翌営業日の寄りで売る。平均は1回あたり。資金30万円を入れた場合の10年合計と最悪の1回も出す");
for (const [s, name] of Object.entries(NAMES)) {
  const bars = JSON.parse(readFileSync(`${CACHE}/${s}-1d-10y.json`, "utf8")) as DailyBar[];
  const rows: [string, number][] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    if (new Date(`${p.date}T00:00:00Z`).getUTCDay() !== 1 || usMarketClosed(p.date) || !(b.o > 0) || !(p.c > 0)) continue;
    const r = (b.o + (b.dividend ?? 0)) / p.c - 1;
    if (Math.abs(r) > 0.2) continue;
    rows.push([b.date, r]);
  }
  const a = stat(rows.map((x) => x[1])), sorted = rows.map((x) => x[1]).sort((x, y) => x - y);
  const sd = Math.sqrt(rows.reduce((q, x) => q + (x[1] - a.m / 1e4) ** 2, 0) / rows.length);
  const years = new Map<string, number>();
  for (const [d, r] of rows) years.set(d.slice(0, 4), (years.get(d.slice(0, 4)) ?? 0) + r);
  const neg = [...years].filter(([y, v]) => y >= "2017" && v < 0).map(([y]) => y);
  console.log(`${(s.slice(0, 4) + " " + name).padEnd(24)} ${String(a.n).padStart(3)}回 平均${f(a.m, 6)}bp t${f(a.t, 5, 2)} 勝率${f((rows.filter((x) => x[1] > 0).length / rows.length) * 100, 4, 0)}% ぶれ${f(sd * 100, 5, 2)}% 平均÷ぶれ${f(a.m / 1e4 / sd, 5, 2)} 最悪${f(sorted[0] * 100, 6, 2)}% | ${PER.map(([lo, hi]) => { const p = stat(rows.filter(([d]) => d >= lo && d < hi).map((x) => x[1])); return `${f(p.m, 6)}/${f(p.t, 5, 2)}`; }).join(" |")} | 30万円で10年 ${Math.round(rows.reduce((q, x) => q + x[1], 0) * 300000).toLocaleString("ja-JP").padStart(8)}円 最悪の1回 ${Math.round(sorted[0] * 300000).toLocaleString("ja-JP").padStart(7)}円 マイナスの年: ${neg.join(" ") || "なし"}`);
}
