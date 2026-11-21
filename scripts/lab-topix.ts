/**
 * TOPIX500 の残りの銘柄（これまで検証にも本番にも使っていない235銘柄、細かい呼値の対象）で同じルールが通用するか、
 * 対象を TOPIX500 全体に広げると上位2銘柄の成績がどう変わるかを見る。
 *   npx tsx scripts/lab-fetch-topix.ts && npx tsx scripts/lab-topix.ts
 * TOPIX500 の一覧は今の時点のものなので、過去に外れた銘柄は入っていない（成績は実際より良く出る側に偏る）。
 */
import { tickSize } from "../src/core/market";
import { ETFS, PERIODS, build, f, stat, tester } from "./lab";
import type { Rec } from "./lab";

const DROP = ["6103.T", "6594.T", "7004.T"]; // TOPIX500 でないと分かった3銘柄
const A = build((s) => !ETFS.includes(s) && !DROP.includes(s)), B = build(() => true, ".cachet");
const merged = new Map<string, Rec[]>();
for (const u of [A, B]) for (const [d, rs] of u.byDay) merged.set(d, [...(merged.get(d) ?? []), ...rs]);
const GROUPS: [string, Map<string, Rec[]>, number][] = [["今の257銘柄", A.byDay, new Set(A.recs.map((r) => r.s)).size], ["使っていない235銘柄", B.byDay, new Set(B.recs.map((r) => r.s)).size], ["TOPIX500 全体", merged, new Set([...A.recs, ...B.recs].map((r) => r.s)).size]];
const days = A.days;
const yen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n / 1000)}`.padStart(6);
function sim(byDay: Map<string, Rec[]>, o: { n: number; budget: number; short?: boolean; slip?: number; filter?: (r: Rec) => boolean }) {
  const dir = o.short ? -1 : 1;
  const dl: [string, number][] = [];
  let held = 0, traded = 0;
  for (const d of days) {
    const c = (byDay.get(d) ?? []).filter((r) => -dir * r.gap >= 0.01 && (o.filter?.(r) ?? true) && r.px * (1 + r.gap) * 100 <= o.budget).sort((a, b) => dir * (a.gap - b.gap)).slice(0, o.n);
    let pnl = 0;
    for (const r of c) {
      const open = r.px * (1 + r.gap), adv = o.short ? r.highPct : -r.lowPct;
      pnl += Math.floor(o.budget / (open * 100)) * 100 * open * (adv >= 0.005 ? -0.005 - ((o.slip ?? 1) * tickSize(open, true)) / open : dir * r.intra);
    }
    if (c.length) { traded++; held += c.length; }
    dl.push([d, pnl]);
  }
  const m = new Map<string, number>();
  for (const [d, v] of dl) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + v);
  const mv = [...m.values()].sort((a, b) => a - b);
  let peak = 0, cum = 0, dd = 0;
  for (const [, v] of dl) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  return `取引日${String(traded).padStart(5)} 合計${yen(cum)} t${f(stat(dl.filter((x) => x[1] !== 0).map((x) => x[1])).t, 5, 2)} +月${f((mv.filter((v) => v > 0).length / mv.length) * 100, 3, 0)}% 最悪月${yen(mv[0])} 落込${yen(dd)} 期間[${PERIODS.map(([lo, hi]) => yen(dl.filter(([d]) => d >= lo && d < hi).reduce((a, x) => a + x[1], 0))).join("")}]`;
}
console.log("金額は千円。期間ごとの合計は 2017–19 / 2020–22 / 2023–");
console.log("\n=== 全銘柄の日平均（1%以上安く寄った銘柄、損切りなし。上乗せは同じ銘柄群の平均との差）");
for (const [name, u] of [["今の257銘柄", A], ["使っていない235銘柄", B]] as const) tester(u)(name, "intra", (r) => r.gap <= -0.01 && r.gap > -0.1);
for (const [title, o] of [["買い 2銘柄×25万円", { n: 2, budget: 250000 }], ["買い 3銘柄×50万円", { n: 3, budget: 500000 }], ["買い 2銘柄×25万円・損切りの滑り3ティック", { n: 2, budget: 250000, slip: 3 }], ["買い 2銘柄×25万円・10%超のギャップは除く", { n: 2, budget: 250000, filter: (r: Rec) => r.gap > -0.1 }], ["売り 2銘柄×25万円（検証だけ）", { n: 2, budget: 250000, short: true }]] as const) {
  console.log(`\n=== ${title}`);
  for (const [name, byDay, n] of GROUPS) console.log(`  ${(name + `（${n}）`).padEnd(22)} ${sim(byDay, o)}`);
}
