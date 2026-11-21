/**
 * 2銘柄×25万円（条件なしの安寄り買い）の作り込み。選び方、ギャップの下限・上限、損切り幅、絞り込みを1つずつ変えて、
 * これまでの260銘柄と、ルール選びに使っていない561銘柄（株価500円以上）の両方で良くなるかを見る。
 *   npx tsx scripts/lab-multi.ts
 */
import { tickSize } from "../src/core/market";
import { ETFS, PERIODS, build, f, mean, stat } from "./lab";
import type { Rec } from "./lab";

const U: [string, ReturnType<typeof build>, (r: Rec) => boolean][] = [["260", build((s) => !ETFS.includes(s)), () => true], ["561", build(() => true, ".cachew"), (r) => r.px >= 500]];
interface Opt { n?: number; budget?: number; min?: number; cap?: number; stop?: number | null; pick?: (c: Rec[], n: number, d: string) => Rec[]; filter?: (r: Rec) => boolean; slip?: number }
const yen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n / 1000)}`.padStart(6);
function run(u: ReturnType<typeof build>, base: (r: Rec) => boolean, o: Opt) {
  const n = o.n ?? 2, budget = o.budget ?? 250000, min = o.min ?? 0.01, cap = o.cap ?? 0.25, stop = o.stop === undefined ? 0.005 : o.stop;
  const daily: [string, number][] = [];
  for (const d of u.days) {
    // 予算で100株買える銘柄だけを候補にする
    const c = u.byDay.get(d)!.filter((r) => base(r) && r.gap <= -min && r.gap > -cap && (o.filter?.(r) ?? true) && r.px * (1 + r.gap) * 100 <= budget).sort((a, b) => a.gap - b.gap);
    let pnl = 0;
    for (const r of o.pick ? o.pick(c, n, d) : c.slice(0, n)) {
      const open = r.px * (1 + r.gap), shares = Math.floor(budget / (open * 100)) * 100;
      const ret = stop != null && r.lowPct <= -stop ? -stop - ((o.slip ?? 1) * tickSize(open, true)) / open : r.intra;
      pnl += shares * open * ret;
    }
    daily.push([d, pnl]);
  }
  const m = new Map<string, number>();
  for (const [d, v] of daily) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + v);
  const mv = [...m.values()].sort((a, b) => a - b);
  let peak = 0, cum = 0, dd = 0;
  for (const [, v] of daily) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  const act = daily.filter((x) => x[1] !== 0);
  return `合計${yen(cum)} t${f(stat(act.map((x) => x[1])).t, 5, 2)} +月${f((mv.filter((v) => v > 0).length / mv.length) * 100, 3, 0)}% 最悪月${yen(mv[0])} 落込${yen(dd)} 期間[${PERIODS.map(([lo, hi]) => yen(daily.filter(([d]) => d >= lo && d < hi).reduce((a, x) => a + x[1], 0))).join("")}]`;
}
const line = (name: string, o: Opt) => console.log(`${name.padEnd(34)} ${U.map(([label, u, base]) => `${label}: ${run(u, base, o)}`).join("  ‖  ")}`);
console.log("金額は千円。合計・最悪の月・最大の落ち込み・期間ごとの合計（2017–19 / 2020–22 / 2023–）。2銘柄×25万円が基準");
line("基準（ギャップ最大の2銘柄）", {});
console.log("--- 選び方");
line("2〜3番目に大きい", { pick: (c, n) => c.slice(1, 1 + n) });
line("3〜4番目に大きい", { pick: (c, n) => c.slice(2, 2 + n) });
line("5〜6番目に大きい", { pick: (c, n) => c.slice(4, 4 + n) });
line("ギャップが小さい2銘柄（-1%に近い）", { pick: (c, n) => c.slice(-n) });
line("まん中の2銘柄", { pick: (c, n) => c.slice(Math.max(0, Math.floor(c.length / 2) - 1), Math.max(0, Math.floor(c.length / 2) - 1) + n) });
line("前日の下げが大きい2銘柄", { pick: (c, n) => [...c].sort((a, b) => a.pRet - b.pRet).slice(0, n) });
line("相場より安く寄った幅が大きい2銘柄", { pick: (c, n) => c.slice(0, n) , filter: (r) => r.gap - r.mktGap <= -0.01 });
console.log("--- 銘柄数（合計50万円のまま）");
line("1銘柄×50万円", { n: 1, budget: 500000 });
line("3銘柄×16.7万円", { n: 3, budget: 166667 });
line("4銘柄×12.5万円", { n: 4, budget: 125000 });
console.log("--- ギャップの下限");
for (const x of [0.005, 0.015, 0.02, 0.03]) line(`${x * 100}%以上安く寄った`, { min: x });
console.log("--- ギャップの上限");
for (const x of [0.1, 0.07, 0.05, 0.03]) line(`${x * 100}%より大きいギャップは除く`, { cap: x });
console.log("--- 損切り幅");
for (const x of [0.003, 0.0075, 0.01, 0.015, 0.02, null]) line(x == null ? "損切りなし" : `損切り ${x * 100}%`, { stop: x });
line("損切り0.5%・滑り3ティック", { slip: 3 });
console.log("--- 絞り込み");
line("相場全体は安くない（平均ギャップ > -0.3%）", { filter: (r) => r.mktGap > -0.003 });
line("相場全体が安い（平均ギャップ <= -0.3%）", { filter: (r) => r.mktGap <= -0.003 });
line("米国が前日上げ", { filter: (r) => r.us >= 0 });
line("米国が前日下げ", { filter: (r) => r.us < 0 });
line("前日は下げ", { filter: (r) => r.pRet < 0 });
line("前日は上げ", { filter: (r) => r.pRet >= 0 });
line("前日の出来高が2倍未満", { filter: (r) => !(r.pVol >= 2) });
line("200日線より上", { filter: (r) => r.ma200 > 0 });
line("200日線より下", { filter: (r) => r.ma200 <= 0 });
line("株価1,000円以上", { filter: (r) => r.px >= 1000 });
line("株価1,000円未満", { filter: (r) => r.px < 1000 });
for (const [w, name] of [[1, "月"], [2, "火"], [3, "水"], [4, "木"], [5, "金"]] as const) line(`${name}曜だけ`, { filter: (r) => r.dow === w });
void mean;
