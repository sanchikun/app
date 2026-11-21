/**
 * 安寄り買いを1日に複数銘柄へ分けたらどうなるか。ギャップの大きい順に N 銘柄を寄りで買い、0.5%で損切り、引けで売る。
 * 100株単位で、1銘柄あたりの予算に収まる株数だけ買う（予算で100株も買えない銘柄は飛ばして次の銘柄へ）。
 *   npx tsx scripts/lab-top3.ts
 * これまでの260銘柄は本番と同じ条件、広げた561銘柄（ルール選びに使っていない）は株価500円以上・ギャップ10%以内。
 */
import { tickSize } from "../src/core/market";
import { ETFS, build, f, mean, stat } from "./lab";
import type { Rec } from "./lab";

const orig = build((s) => !ETFS.includes(s));
const wide = build(() => true, ".cachew");
const yen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("ja-JP")}`.padStart(9);
interface Opt { n: number; budget: number; cand: (r: Rec) => boolean; fine: boolean; slipTicks: number }
function run(u: typeof orig, o: Opt) {
  const daily: [string, number][] = [];
  let held = 0, traded = 0, invested = 0;
  for (const d of u.days) {
    const c = u.byDay.get(d)!.filter(o.cand).sort((a, b) => a.gap - b.gap);
    let pnl = 0, k = 0;
    for (const r of c) {
      if (k >= o.n) break;
      const open = r.px * (1 + r.gap), shares = Math.floor(o.budget / (open * 100)) * 100;
      if (shares <= 0) continue;
      k++;
      const tick = tickSize(open, o.fine);
      const ret = r.lowPct <= -0.005 ? -0.005 - (o.slipTicks * tick) / open : r.intra;
      pnl += shares * open * ret;
      invested += shares * open;
    }
    daily.push([d, pnl]);
    if (k) { traded++; held += k; }
  }
  const act = daily.filter((x) => x[1] !== 0).map((x) => x[1]);
  const m = new Map<string, number>(), y = new Map<string, number>();
  for (const [d, v] of daily) { m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + v); y.set(d.slice(0, 4), (y.get(d.slice(0, 4)) ?? 0) + v); }
  const mv = [...m.values()].sort((a, b) => a - b);
  let peak = 0, cum = 0, dd = 0;
  for (const [, v] of daily) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  const st = stat(act);
  return { traded, avgHeld: held / Math.max(traded, 1), avgInvested: invested / Math.max(traded, 1), total: cum, t: st.t, month: mean(mv), plus: mv.filter((v) => v > 0).length / mv.length, worstMonth: mv[0], worstDay: Math.min(...daily.map((x) => x[1])), dd, years: [...y].sort().map(([k, v]) => `${k.slice(2)}:${Math.round(v / 1000)}`).join(" "), perBp: (cum / Math.max(invested, 1)) * 1e4 };
}
const gd = (r: Rec) => r.gap <= -0.01;
const clean = (r: Rec) => r.gap > -0.1 && r.px >= 500;
function table(title: string, u: typeof orig, base: (r: Rec) => boolean, fine: boolean, configs: [string, number, number][], slipTicks = 1) {
  console.log(`\n=== ${title}`);
  console.log("  条件                       取引日 平均銘柄 1日の買付  投資額あたりbp  t値    10年合計   月平均  プラスの月  最悪の月   最悪の日   最大の落ち込み");
  for (const [label, n, budget] of configs) for (const [cname, cand] of [["条件なし", (r: Rec) => base(r)], ["候補1  ", (r: Rec) => base(r) && r.pRet <= -0.02]] as const) {
    const r = run(u, { n, budget, cand, fine, slipTicks });
    console.log(`  ${(label + " " + cname).padEnd(24)} ${String(r.traded).padStart(5)} ${f(r.avgHeld, 6, 2)} ${yen(r.avgInvested)} ${f(r.perBp, 10)} ${f(r.t, 8, 2)} ${yen(r.total)} ${yen(r.month)} ${f(r.plus * 100, 7, 0)}% ${yen(r.worstMonth)} ${yen(r.worstDay)} ${yen(r.dd)}`);
    if (label.startsWith("★")) console.log(`      年ごと（千円）: ${r.years}`);
  }
}
const SAME_TOTAL: [string, number, number][] = [["1銘柄×50万円", 1, 500000], ["2銘柄×25万円", 2, 250000], ["3銘柄×16.7万円", 3, 166667], ["5銘柄×10万円", 5, 100000]];
const SAME_EACH: [string, number, number][] = [["★1銘柄×50万円", 1, 500000], ["2銘柄×50万円", 2, 500000], ["★3銘柄×50万円", 3, 500000], ["5銘柄×50万円", 5, 500000], ["10銘柄×50万円", 10, 500000]];
table("A) これまでの260銘柄・合計の予算は同じ50万円（1銘柄あたりを減らす。高い株は100株買えなくなる）", orig, gd, true, SAME_TOTAL);
table("B) これまでの260銘柄・1銘柄50万円のまま銘柄数を増やす（合計の予算が増える）", orig, gd, true, SAME_EACH);
table("C) 使っていない561銘柄・1銘柄50万円・細かい呼値", wide, (r) => gd(r) && clean(r), true, SAME_EACH);
table("D) 使っていない561銘柄・1銘柄50万円・通常の呼値", wide, (r) => gd(r) && clean(r), false, SAME_EACH);
table("E) これまでの260銘柄・1銘柄50万円・損切りの滑り3ティック", orig, gd, true, SAME_EACH, 3);
