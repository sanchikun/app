/**
 * 8巡目：(1) ギャップを「その銘柄のふだんの値動き」で割って選ぶ、(2) 前日までの足の形で選ぶ。
 * 形は切り替え後と同じ（1%以上安く寄った銘柄から2銘柄×25万円、損切り0.5%、引けで売る）。
 * 今の257銘柄（ルール選びに使ってきた）と、TOPIX500 の残り235銘柄（使っていない）を別々に見て、両方で良くなるかを確かめる。
 *   npx tsx scripts/lab-fetch.ts && npx tsx scripts/lab-fetch-topix.ts && npx tsx scripts/lab-round8.ts
 * 使う値は、当日の寄り値（ギャップ）と、前日の引けまでに決まっているもの（atr, pLoc, r5, r20, ma20, lo20, pRet）だけ。
 */
import { existsSync, readFileSync } from "node:fs";
import { jstDate, tickSize } from "../src/core/market";
import type { Bar } from "../src/core/types";
import { CACHE, ETFS, PERIODS, build, f, stat, tester } from "./lab";
import type { Rec } from "./lab";

const DROP = ["6103.T", "6594.T", "7004.T"];
const A = build((s) => !ETFS.includes(s) && !DROP.includes(s)), B = build(() => true, ".cachet");
const U: [string, ReturnType<typeof build>][] = [["257", A], ["235", B]];
interface Opt { n?: number; budget?: number; stop?: number | ((r: Rec) => number) | null; slip?: number; score?: (r: Rec) => number; filter?: (r: Rec) => boolean }
const yen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n / 1000)}`.padStart(6);
/** ギャップをふだんの値動き（14日の平均値幅）で割ったもの。-1 なら「ふだんの1日分だけ安く寄った」 */
const z = (r: Rec) => r.gap / r.atr;

function run(u: ReturnType<typeof build>, o: Opt) {
  const n = o.n ?? 2, budget = o.budget ?? 250000, score = o.score ?? ((r: Rec) => r.gap);
  const daily: [string, number][] = [];
  let trades = 0;
  for (const d of u.days) {
    const c = u.byDay.get(d)!.filter((r) => r.gap <= -0.01 && r.gap > -0.25 && r.atr > 0 && (o.filter?.(r) ?? true) && r.px * (1 + r.gap) * 100 <= budget).sort((a, b) => score(a) - score(b));
    let pnl = 0;
    for (const r of c.slice(0, n)) {
      const open = r.px * (1 + r.gap), shares = Math.floor(budget / (open * 100)) * 100;
      const stop = o.stop === undefined ? 0.005 : typeof o.stop === "function" ? o.stop(r) : o.stop;
      const ret = stop != null && r.lowPct <= -stop ? -stop - ((o.slip ?? 1) * tickSize(open, true)) / open : r.intra;
      pnl += shares * open * ret;
      trades++;
    }
    daily.push([d, pnl]);
  }
  const m = new Map<string, number>();
  for (const [d, v] of daily) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + v);
  const mv = [...m.values()].sort((a, b) => a - b);
  let peak = 0, cum = 0, dd = 0;
  for (const [, v] of daily) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  const act = daily.filter((x) => x[1] !== 0);
  return `回${String(trades).padStart(5)} 合計${yen(cum)} t${f(stat(act.map((x) => x[1])).t, 5, 2)} 1回${f(cum / Math.max(1, trades), 5, 0)}円 最悪月${yen(mv[0])} 落込${yen(dd)} 期間[${PERIODS.map(([lo, hi]) => yen(daily.filter(([d]) => d >= lo && d < hi).reduce((a, x) => a + x[1], 0))).join("")}]`;
}
const line = (name: string, o: Opt) => console.log(`${name.padEnd(30)} ${U.map(([label, u]) => `${label}: ${run(u, o)}`).join("  ‖  ")}`);

console.log("金額は千円（1回あたりは円）。期間ごとの合計は 2017–19 / 2020–22 / 2023–。2銘柄×25万円・損切り0.5%");
line("基準（ギャップ最大の2銘柄）", {});

console.log("\n=== 1. ギャップ ÷ ふだんの値動き");
console.log("--- 全銘柄の日平均（損切りなし、上乗せは同じ銘柄群の平均との差）");
for (const [label, u] of U) {
  const T = tester(u);
  for (const [lo, hi] of [[0, 0.5], [0.5, 1], [1, 1.5], [1.5, 2.5], [2.5, 99]]) T(`${label} 値動きの ${lo}〜${hi} 倍安い`, "intra", (r) => r.gap <= -0.01 && r.gap > -0.1 && -z(r) >= lo && -z(r) < hi);
}
console.log("--- 選び方を変える");
line("値動き比で最大の2銘柄", { score: z });
line("値動き比で最小の2銘柄", { score: (r) => -z(r) });
line("ギャップ×値動き比", { score: (r) => -r.gap * z(r) });
console.log("--- 絞り込み（選び方はギャップ最大のまま）");
for (const k of [0.5, 0.75, 1, 1.5, 2]) line(`値動きの ${k} 倍以上安い`, { filter: (r) => -z(r) >= k });
for (const k of [1, 1.5, 2, 3]) line(`値動きの ${k} 倍未満`, { filter: (r) => -z(r) < k });
console.log("--- ふだんの値動きそのもの");
for (const [lo, hi] of [[0, 0.015], [0.015, 0.02], [0.02, 0.03], [0.03, 1]]) line(`平均値幅 ${lo * 100}〜${hi * 100}%`, { filter: (r) => r.atr >= lo && r.atr < hi });
console.log("--- 損切りを値動きに合わせる");
for (const k of [0.15, 0.25, 0.35, 0.5]) line(`損切り ${k}×平均値幅`, { stop: (r) => Math.max(0.002, k * r.atr) });

console.log("\n=== 2. 前日までの足の形");
console.log("--- 前日の引けの位置（0 = 安値引け、1 = 高値引け）");
for (const [lo, hi] of [[0, 0.2], [0.2, 0.5], [0.5, 0.8], [0.8, 1.01]]) line(`前日の引けの位置 ${lo}〜${Math.min(1, hi)}`, { filter: (r) => r.pLoc >= lo && r.pLoc < hi });
console.log("--- 前日の終値が20日の安値・高値か");
line("前日が20日安値", { filter: (r) => r.lo20 });
line("前日が20日安値でない", { filter: (r) => !r.lo20 });
line("前日が20日高値", { filter: (r) => r.hi20 });
console.log("--- 直近の騰落");
for (const [lo, hi] of [[-1, -0.05], [-0.05, 0], [0, 0.05], [0.05, 9]]) line(`5日の騰落 ${lo * 100}〜${hi * 100}%`, { filter: (r) => r.r5 >= lo && r.r5 < hi });
for (const [lo, hi] of [[-1, -0.1], [-0.1, 0], [0, 0.1], [0.1, 9]]) line(`20日の騰落 ${lo * 100}〜${hi * 100}%`, { filter: (r) => r.r20 >= lo && r.r20 < hi });
for (const [lo, hi] of [[-1, -0.05], [-0.05, 0], [0, 0.05], [0.05, 9]]) line(`20日線から ${lo * 100}〜${hi * 100}%`, { filter: (r) => r.ma20 >= lo && r.ma20 < hi });
console.log("--- 前日に大きく上げた銘柄の安寄り（上げの反動）");
for (const k of [0.02, 0.03, 0.05]) line(`前日 +${k * 100}%以上`, { filter: (r) => r.pRet >= k });
for (const k of [0.02, 0.03, 0.05]) line(`前日 -${k * 100}%以下`, { filter: (r) => r.pRet <= -k });

// ---- 3. 「値動き比で最大の2銘柄」の確かめ直し
console.log("\n=== 3. 値動き比で選ぶ形の確かめ直し");
console.log("--- 割り方を変える（ギャップ ÷ 平均値幅の k 乗。k=0 が基準、k=1 が値動き比）");
for (const k of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]) line(`k = ${k}`, { score: (r) => r.gap / r.atr ** k });
console.log("--- 損切り・滑りを変える（値動き比で最大の2銘柄 / 基準）");
for (const [name, o] of [["滑り3ティック", { slip: 3 }], ["滑り5ティック", { slip: 5 }], ["損切り0.3%", { stop: 0.003 }], ["損切り1%", { stop: 0.01 }], ["損切りなし", { stop: null }], ["1銘柄×50万円", { n: 1, budget: 500000 }], ["3銘柄×16.7万円", { n: 3, budget: 166667 }]] as [string, Opt][]) {
  line(`${name}: 値動き比`, { ...o, score: z });
  line(`${name}: 基準`, o);
}
console.log("--- 10%を超えるギャップ・低位株を除いても同じか");
line("ギャップ10%未満・株価500円以上: 値動き比", { score: z, filter: (r) => r.gap > -0.1 && r.px >= 500 });
line("ギャップ10%未満・株価500円以上: 基準", { filter: (r) => r.gap > -0.1 && r.px >= 500 });

// 日ごとの差（値動き比 − 基準）と年ごとの合計。TOPIX500 全体（本番を広げる対象）でも見る
const merged = new Map<string, Rec[]>();
for (const u of [A, B]) for (const [d, rs] of u.byDay) merged.set(d, [...(merged.get(d) ?? []), ...rs]);
const ALL = { recs: [...A.recs, ...B.recs], byDay: merged, days: A.days };
function dailyPnl(u: { byDay: Map<string, Rec[]>; days: string[] }, score: (r: Rec) => number, slip = 1): Map<string, { pnl: number; picks: Rec[] }> {
  const out = new Map<string, { pnl: number; picks: Rec[] }>();
  for (const d of u.days) {
    const picks = (u.byDay.get(d) ?? []).filter((r) => r.gap <= -0.01 && r.atr > 0 && r.px * (1 + r.gap) * 100 <= 250000).sort((a, b) => score(a) - score(b)).slice(0, 2);
    let pnl = 0;
    for (const r of picks) { const open = r.px * (1 + r.gap); pnl += Math.floor(250000 / (open * 100)) * 100 * open * (r.lowPct <= -0.005 ? -0.005 - (slip * tickSize(open, true)) / open : r.intra); }
    out.set(d, { pnl, picks });
  }
  return out;
}
console.log("--- 日ごとの差（値動き比 − 基準）の t値と、年ごとの合計（千円）");
for (const [label, u] of [["257", A], ["235", B], ["TOPIX500 全体", ALL]] as const) {
  const g = dailyPnl(u, (r) => r.gap), zz = dailyPnl(u, z);
  const diff = u.days.map((d) => zz.get(d)!.pnl - g.get(d)!.pnl);
  const same = u.days.reduce((a, d) => a + zz.get(d)!.picks.filter((r) => g.get(d)!.picks.includes(r)).length, 0), tot = u.days.reduce((a, d) => a + g.get(d)!.picks.length, 0);
  const st = stat(diff.filter((x) => x !== 0));
  const sum = (m: Map<string, { pnl: number }>, y?: string) => u.days.filter((d) => !y || d.startsWith(y)).reduce((a, d) => a + m.get(d)!.pnl, 0);
  const stopRate = (m: Map<string, { picks: Rec[] }>) => { const p = u.days.flatMap((d) => m.get(d)!.picks); return (p.filter((r) => r.lowPct <= -0.005).length / p.length) * 100; };
  const med = (m: Map<string, { picks: Rec[] }>, fn: (r: Rec) => number) => { const p = u.days.flatMap((d) => m.get(d)!.picks.map(fn)).sort((a, b) => a - b); return p[p.length >> 1]; };
  console.log(`${label}: 基準 合計${yen(sum(g))} t${f(stat([...g.values()].map((x) => x.pnl).filter((x) => x !== 0)).t, 5, 2)} / 値動き比 合計${yen(sum(zz))} t${f(stat([...zz.values()].map((x) => x.pnl).filter((x) => x !== 0)).t, 5, 2)} / 差の t${f(st.t, 5, 2)}（差が出た日 ${st.n}） 同じ銘柄 ${f((same / tot) * 100, 3, 0)}%`);
  console.log(`   損切りにかかる割合 基準 ${f(stopRate(g), 3, 0)}% → 値動き比 ${f(stopRate(zz), 3, 0)}%、ギャップの中央値 ${f(med(g, (r) => r.gap * 100), 5, 2)}% → ${f(med(zz, (r) => r.gap * 100), 5, 2)}%、平均値幅の中央値 ${f(med(g, (r) => r.atr * 100), 4, 2)}% → ${f(med(zz, (r) => r.atr * 100), 4, 2)}%`);
  console.log(`   年: ${["2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"].map((y) => `${y.slice(2)}:${yen(sum(g, y)).trim()}→${yen(sum(zz, y)).trim()}`).join("  ")}`);
}

// ---- 4. 10時に売る形でも同じか（1時間足2年、今の257銘柄だけ。先に npx tsx scripts/lab-fetch1h.ts）
{
  const first = new Map<string, { c: number; l: number }>();
  for (const s of new Set(A.recs.map((r) => r.s))) {
    const file = `${CACHE}/${s}-1h-730d.json`;
    if (!existsSync(file)) continue;
    const seen = new Set<string>();
    for (const b of JSON.parse(readFileSync(file, "utf8")) as Bar[]) { const d = jstDate(b.t); if (seen.has(d)) continue; seen.add(d); if ((b.t - (Date.parse(`${d}T00:00:00Z`) / 1000 - 9 * 3600)) / 3600 === 9) first.set(`${s} ${d}`, { c: b.c, l: b.l }); }
  }
  if (first.size) {
    console.log("\n=== 4. 10時に売る形（1時間足2年、257銘柄、2銘柄×25万円、円）。寄り値は日足、10時の値は最初の1時間足の終値");
    const tk = 0.0003;
    for (const [name, score] of [["基準（ギャップ最大）", (r: Rec) => r.gap], ["値動き比で最大", z]] as const) {
      for (const [how, fn] of [["10時に売る・損切りなし", (r: Rec, b: { c: number; l: number }, open: number) => b.c / open - 1 - tk], ["10時に売る・損切り0.5%", (r: Rec, b: { c: number; l: number }, open: number) => (b.l / open - 1 <= -0.005 ? -0.005 - tk : b.c / open - 1 - tk)], ["引けで売る・損切り0.5%", (r: Rec) => (r.lowPct <= -0.005 ? -0.005 - tk : r.intra)]] as const) {
        const dl: number[] = [], halves: number[][] = [[], []];
        const ds = A.days.filter((d) => A.byDay.get(d)!.some((r) => first.has(`${r.s} ${d}`)));
        ds.forEach((d, i) => {
          const picks = A.byDay.get(d)!.filter((r) => r.gap <= -0.01 && r.atr > 0 && r.div === 0 && first.has(`${r.s} ${d}`) && r.px * (1 + r.gap) * 100 <= 250000).sort((a, b) => score(a) - score(b)).slice(0, 2);
          let pnl = 0;
          for (const r of picks) { const open = r.px * (1 + r.gap); pnl += Math.floor(250000 / (open * 100)) * 100 * open * fn(r, first.get(`${r.s} ${d}`)!, open); }
          dl.push(pnl); halves[i < ds.length / 2 ? 0 : 1].push(pnl);
        });
        let peak = 0, cum = 0, dd = 0;
        for (const v of dl) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
        console.log(`  ${(name + "・" + how).padEnd(34)} ${ds.length}日 合計${yen(cum)} t${f(stat(dl.filter((x) => x !== 0)).t, 5, 2)} 落込${yen(dd)} 前半${yen(halves[0].reduce((a, b) => a + b, 0))} 後半${yen(halves[1].reduce((a, b) => a + b, 0))}`);
      }
    }
  }
}
