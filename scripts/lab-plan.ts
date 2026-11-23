/**
 * 切り替え後の形（TOPIX500 全体・上位2銘柄×25万円・損切り0.5%・条件なし ＋ 1306 を月曜の引けで700口）について、
 * 1) 何か月様子を見れば判断できるか  2) 最悪の時期の日ごとの動き  3) 税金を引いた手取り
 *   npx tsx scripts/lab-fetch.ts && npx tsx scripts/lab-fetch-topix.ts && npx tsx scripts/lab-plan.ts
 * 日足の試算なので、10時に売る・損切りを 9:05 からにする分は入っていない（引けで売る・寄りから損切り）。
 */
import { readFileSync } from "node:fs";
import type { DailyBar } from "../src/core/gapstudy";
import { tickSize, usMarketClosed } from "../src/core/market";
import { CACHE, ETFS, build, f } from "./lab";
import type { Rec } from "./lab";

const DROP = ["6103.T", "6594.T", "7004.T"];
const A = build((s) => !ETFS.includes(s) && !DROP.includes(s)), B = build(() => true, ".cachet");
const byDay = new Map<string, Rec[]>();
for (const u of [A, B]) for (const [d, rs] of u.byDay) byDay.set(d, [...(byDay.get(d) ?? []), ...rs]);
const days = A.days;
function gapLeg(slipTicks: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of days) {
    let pnl = 0;
    for (const r of (byDay.get(d) ?? []).filter((x) => x.gap <= -0.01 && x.px * (1 + x.gap) * 100 <= 250000).sort((a, b) => a.gap - b.gap).slice(0, 2)) {
      const open = r.px * (1 + r.gap);
      pnl += Math.floor(250000 / (open * 100)) * 100 * open * (r.lowPct <= -0.005 ? -0.005 - (slipTicks * tickSize(open, true)) / open : r.intra);
    }
    out.set(d, pnl);
  }
  return out;
}
// 月曜の持ち越し: 損益は売った日（翌営業日）に付ける
const etf = JSON.parse(readFileSync(`${CACHE}/1306.T-1d-10y.json`, "utf8")) as DailyBar[];
const mon = new Map<string, number>();
for (let i = 1; i < etf.length; i++) {
  const b = etf[i], p = etf[i - 1];
  if (new Date(`${p.date}T00:00:00Z`).getUTCDay() !== 1 || usMarketClosed(p.date) || !(b.o > 0)) continue;
  const r = (b.o + (b.dividend ?? 0)) / p.c - 1;
  if (Math.abs(r) < 0.2) mon.set(b.date, 700 * p.c * r);
}
const yen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("ja-JP")}円`;
const phi = (x: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp((-x * x) / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const SCEN: [string, number[]][] = [
  ["安寄り買いだけ（滑り1ティック）", days.map((d) => gapLeg(1).get(d)!)],
  ["安寄り買い＋月曜の持ち越し（滑り1ティック）", (() => { const g = gapLeg(1); return days.map((d) => g.get(d)! + (mon.get(d) ?? 0)); })()],
  ["安寄り買い＋月曜の持ち越し（滑り3ティック）", (() => { const g = gapLeg(3); return days.map((d) => g.get(d)! + (mon.get(d) ?? 0)); })()],
  ["安寄り買い＋月曜の持ち越し（滑り5ティック）", (() => { const g = gapLeg(5); return days.map((d) => g.get(d)! + (mon.get(d) ?? 0)); })()],
];
console.log(`${days[0]}〜${days[days.length - 1]}（${days.length}営業日、約${(days.length / 245).toFixed(1)}年）`);
console.log("\n=== 1) 何か月様子を見れば判断できるか");
console.log("  「偶然ではない」の目安を t値2 とすると必要な期間と、その期間の合計がマイナスで終わる確率（過去10年を実際に区切って数えたもの）");
for (const [name, dl] of SCEN) {
  const n = dl.length, mu = dl.reduce((a, x) => a + x, 0) / n, sd = Math.sqrt(dl.reduce((a, x) => a + (x - mu) ** 2, 0) / (n - 1));
  const need = (2 * sd / mu) ** 2;
  const win = (len: number) => { let neg = 0, cnt = 0; for (let i = 0; i + len <= n; i += 5) { cnt++; if (dl.slice(i, i + len).reduce((a, x) => a + x, 0) < 0) neg++; } return neg / cnt; };
  console.log(`  ${name}\n     1日平均 ${yen(mu)}、1日のぶれ ${yen(sd).replace("+", "")}、月平均 ${yen(mu * 20.4)}。t値2 に届くまで約 ${Math.round(need)}営業日（${(need / 20.4).toFixed(1)}か月）`);
  console.log(`     マイナスで終わる割合: 1か月 ${f(win(20) * 100, 3, 0)}%、3か月 ${f(win(61) * 100, 3, 0)}%、6か月 ${f(win(122) * 100, 3, 0)}%、1年 ${f(win(245) * 100, 3, 0)}%、2年 ${f(win(490) * 100, 3, 0)}%   （ぶれから計算した値: 1か月 ${f(phi((-mu * Math.sqrt(20)) / sd) * 100, 3, 0)}%、6か月 ${f(phi((-mu * Math.sqrt(122)) / sd) * 100, 3, 0)}%、1年 ${f(phi((-mu * Math.sqrt(245)) / sd) * 100, 3, 0)}%）`);
}
const base = SCEN[1][1];
console.log("\n=== 2) 最悪の時期（安寄り買い＋月曜の持ち越し、滑り1ティック）");
let peak = 0, cum = 0, dd = 0, ddStart = 0, ddEnd = 0, peakI = 0, streak = 0, worstStreak = 0, streakEnd = 0;
const cums: number[] = [];
base.forEach((v, i) => { cum += v; cums.push(cum); if (cum > peak) { peak = cum; peakI = i; } if (cum - peak < dd) { dd = cum - peak; ddStart = peakI; ddEnd = i; } if (v < 0) { streak++; if (streak > worstStreak) { worstStreak = streak; streakEnd = i; } } else if (v > 0) streak = 0; });
const recover = cums.findIndex((c, i) => i > ddEnd && c >= cums[ddStart]);
console.log(`  最大の落ち込み ${yen(dd)}（${days[ddStart]} の高値から ${days[ddEnd]} まで ${ddEnd - ddStart}営業日）。元の水準に戻ったのは ${recover > 0 ? `${days[recover]}（底から ${recover - ddEnd}営業日後）` : "まだ"}`);
console.log(`  負けが続いた最長 ${worstStreak}営業日（${days[streakEnd - worstStreak + 1]}〜${days[streakEnd]}、その間の合計 ${yen(base.slice(streakEnd - worstStreak + 1, streakEnd + 1).reduce((a, x) => a + x, 0))}）`);
const worstWin = (len: number) => { let w = 0, at = 0; for (let i = 0; i + len <= base.length; i++) { const s = base.slice(i, i + len).reduce((a, x) => a + x, 0); if (s < w) { w = s; at = i; } } return `${yen(w)}（${days[at]}〜${days[at + len - 1]}）`; };
console.log(`  最悪の1日 ${yen(Math.min(...base))}（${days[base.indexOf(Math.min(...base))]}）、最悪の5営業日 ${worstWin(5)}、最悪の20営業日 ${worstWin(20)}、最悪の60営業日 ${worstWin(61)}`);
for (const [title, from, to] of [["2020年のコロナ急落", "2020-02-17", "2020-04-03"], ["2024年8月の急落", "2024-07-22", "2024-08-23"], ["2018年10〜12月", "2018-10-01", "2018-12-28"], ["2025年4月の急落", "2025-03-24", "2025-04-25"]] as const) {
  const idx = days.map((d, i) => [d, i] as const).filter(([d]) => d >= from && d <= to);
  if (!idx.length) continue;
  const weeks = new Map<string, number>();
  for (const [d, i] of idx) { const dt = new Date(`${d}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); const k = dt.toISOString().slice(5, 10); weeks.set(k, (weeks.get(k) ?? 0) + base[i]); }
  const vals = idx.map(([, i]) => base[i]);
  console.log(`  ${title}（${from}〜${to}）: 合計 ${yen(vals.reduce((a, x) => a + x, 0))}、勝ち ${vals.filter((x) => x > 0).length}日 負け ${vals.filter((x) => x < 0).length}日、最悪の日 ${yen(Math.min(...vals))}\n     週ごと: ${[...weeks].map(([k, v]) => `${k}週 ${Math.round(v / 1000)}千`).join("  ")}`);
}
console.log("\n=== 3) 税金を引いた手取り（利益の 20.315%。損は翌年以降3年まで繰り越して差し引く。手数料は0円とする）");
for (const [name, dl] of [SCEN[1], SCEN[2]]) {
  const yr = new Map<string, number>();
  days.forEach((d, i) => yr.set(d.slice(0, 4), (yr.get(d.slice(0, 4)) ?? 0) + dl[i]));
  let carry: number[] = [], gross = 0, tax = 0;
  const rows: string[] = [];
  for (const [y, v] of [...yr].sort()) {
    gross += v;
    let taxable = v;
    if (v > 0) { for (let k = 0; k < carry.length && taxable > 0; k++) { const use = Math.min(carry[k], taxable); carry[k] -= use; taxable -= use; } const t = taxable * 0.20315; tax += t; rows.push(`${y}:${Math.round(v / 1000)}千→手取り${Math.round((v - t) / 1000)}千`); carry = [...carry, 0].slice(-3); }
    else { rows.push(`${y}:${Math.round(v / 1000)}千（税なし、損を繰り越し）`); carry = [...carry, -v].slice(-3); }
  }
  const years = days.length / 245;
  console.log(`  ${name}\n     10年の合計 ${yen(gross)} → 税金 ${yen(-tax)} → 手取り ${yen(gross - tax)}（月平均 ${yen(gross / years / 12)} → ${yen((gross - tax) / years / 12)}）\n     ${rows.join("  ")}`);
}
