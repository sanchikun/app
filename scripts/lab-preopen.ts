/**
 * 寄り付く前に銘柄を決めておく形が成り立つか。前日の引けまで（と、朝までに分かる米国市場）の情報だけで K 銘柄を選び、
 * 「前日終値の g% 下」に寄り付きだけ有効な指値（寄指）を出す。寄り値が指値以下なら寄り値で買え、そうでなければ買えない。
 * 買えたら損切り0.5%、引けで売る。買付余力は注文の時点で押さえられるので、K 銘柄 × 1銘柄の予算 = 資金。
 *   npx tsx scripts/lab-fetch-topix.ts && npx tsx scripts/lab-preopen.ts
 */
import { tickSize } from "../src/core/market";
import { ETFS, PERIODS, build, f, stat } from "./lab";
import type { Rec } from "./lab";

const DROP = ["6103.T", "6594.T", "7004.T"];
const A = build((s) => !ETFS.includes(s) && !DROP.includes(s)), B = build(() => true, ".cachet");
const byDay = new Map<string, Rec[]>();
for (const u of [A, B]) for (const [d, rs] of u.byDay) byDay.set(d, [...(byDay.get(d) ?? []), ...rs]);
const days = A.days;
const yen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n / 1000)}`.padStart(6);
let seed = 7;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
interface Opt { k: number; budget: number; g?: number; score?: (r: Rec) => number; day?: (r: Rec) => boolean; filter?: (r: Rec) => boolean }
function run(name: string, o: Opt) {
  const g = o.g ?? 0.01;
  const dl: [string, number][] = [];
  let orders = 0, fills = 0, sumRet = 0;
  for (const d of days) {
    const all = byDay.get(d) ?? [];
    let pnl = 0;
    if (all.length && (o.day?.(all[0]) ?? true)) {
      // 前日終値で100株買える銘柄から、点数の高い順に K 銘柄（点数がなければ無作為）
      const pool = all.filter((r) => r.px * 100 <= o.budget && (o.filter?.(r) ?? true));
      const pick = o.score ? [...pool].sort((a, b) => o.score!(b) - o.score!(a)).slice(0, o.k) : Array.from({ length: Math.min(o.k, pool.length) }, () => pool[Math.floor(rand() * pool.length)]);
      for (const r of pick) {
        orders++;
        if (r.gap > -g) continue;
        fills++;
        const open = r.px * (1 + r.gap), ret = r.lowPct <= -0.005 ? -0.005 - tickSize(open, true) / open : r.intra;
        sumRet += ret;
        pnl += Math.floor(o.budget / (r.px * (1 - g) * 100)) * 100 * open * ret;
      }
    }
    dl.push([d, pnl]);
  }
  const m = new Map<string, number>();
  for (const [d, v] of dl) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + v);
  const mv = [...m.values()].sort((a, b) => a - b);
  let peak = 0, cum = 0, dd = 0;
  for (const [, v] of dl) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  console.log(`  ${name.padEnd(40)} 約定${f((fills / Math.max(orders, 1)) * 100, 5, 1)}%（${String(fills).padStart(5)}回） 1回平均${f((sumRet / Math.max(fills, 1)) * 1e4, 6)}bp 合計${yen(cum)} t${f(stat(dl.filter((x) => x[1] !== 0).map((x) => x[1])).t, 5, 2)} +月${f((mv.filter((v) => v > 0).length / mv.length) * 100, 3, 0)}% 落込${yen(dd)} 期間[${PERIODS.map(([lo, hi]) => yen(dl.filter(([d]) => d >= lo && d < hi).reduce((a, x) => a + x[1], 0))).join("")}]`);
}
// 参考: 寄り値を見てから選べる場合（これまでの前提）
function ideal(name: string, n: number, budget: number) {
  const dl: [string, number][] = [];
  for (const d of days) {
    let pnl = 0;
    for (const r of (byDay.get(d) ?? []).filter((x) => x.gap <= -0.01 && x.px * (1 + x.gap) * 100 <= budget).sort((a, b) => a.gap - b.gap).slice(0, n)) { const open = r.px * (1 + r.gap); pnl += Math.floor(budget / (open * 100)) * 100 * open * (r.lowPct <= -0.005 ? -0.005 - tickSize(open, true) / open : r.intra); }
    dl.push([d, pnl]);
  }
  console.log(`  ${name.padEnd(40)} 合計${yen(dl.reduce((a, x) => a + x[1], 0))} t${f(stat(dl.filter((x) => x[1] !== 0).map((x) => x[1])).t, 5, 2)}`);
}
console.log("TOPIX500 の490銘柄、10年。金額は千円。期間ごとの合計は 2017–19 / 2020–22 / 2023–");
console.log("\n=== 参考: 寄り値を見てから上位を選べる場合");
ideal("2銘柄×25万円", 2, 250000);
const SCORES: [string, ((r: Rec) => number) | undefined, ((r: Rec) => boolean)?][] = [
  ["無作為", undefined],
  ["値動きの大きい銘柄（14日の平均値幅）", (r) => r.atr],
  ["前日に大きく下げた銘柄", (r) => -r.pRet],
  ["前日に大きく上げた銘柄", (r) => r.pRet],
  ["前日の場中に大きく下げた銘柄", (r) => -r.pIntra],
  ["前日が安値引けの銘柄", (r) => -r.pLoc],
  ["5日間で大きく下げた銘柄", (r) => -r.r5],
  ["5日間で大きく上げた銘柄", (r) => r.r5],
  ["20日間で大きく上げた銘柄", (r) => r.r20],
  ["前日の出来高が急増した銘柄", (r) => (Number.isNaN(r.pVol) ? 0 : r.pVol)],
  ["前日に大きく下げ & 値動きが大きい", (r) => -r.pRet * r.atr],
];
for (const [k, budget] of [[2, 250000], [5, 100000]] as const) {
  console.log(`\n=== 前日終値の1%下に寄指、${k}銘柄×${budget / 10000}万円`);
  for (const [name, score] of SCORES) run(name, { k, budget, score });
}
console.log("\n=== 指値の深さ（前日に大きく下げた2銘柄×25万円）");
for (const g of [0.005, 0.01, 0.02, 0.03]) run(`前日終値の${g * 100}%下`, { k: 2, budget: 250000, g, score: (r) => -r.pRet });
console.log("\n=== 朝までに分かる米国市場で、注文を出す日を選ぶ（値動きの大きい2銘柄×25万円）");
run("毎日", { k: 2, budget: 250000, score: (r) => r.atr });
run("米国が前日 -1%以下の朝だけ", { k: 2, budget: 250000, score: (r) => r.atr, day: (r) => r.us <= -0.01 });
run("米国が前日 -0.5%以下の朝だけ", { k: 2, budget: 250000, score: (r) => r.atr, day: (r) => r.us <= -0.005 });
run("米国が前日 プラスの朝だけ", { k: 2, budget: 250000, score: (r) => r.atr, day: (r) => r.us > 0 });
run("米国が -1%以下の朝、前日に大きく下げた2銘柄", { k: 2, budget: 250000, score: (r) => -r.pRet, day: (r) => r.us <= -0.01 });
run("米国がプラスの朝、前日に大きく下げた2銘柄", { k: 2, budget: 250000, score: (r) => -r.pRet, day: (r) => r.us > 0 });
