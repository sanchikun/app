/**
 * 安寄り買い（ギャップの大きい順に2銘柄×25万円、損切り0.5%、引けで売る）に、日経ダブルインバース（1357）を
 * 寄りで買って引けで売るヘッジを足すと、最悪の日や落ち込みが浅くなるか。日足だけの試算（10:00 の決済は入れていない）。
 *   npx tsx scripts/lab-hedge.ts
 * 1357 は日経平均の -2倍なので、株50万円ぶんをほぼ打ち消すのは 25万円ぶん。
 */
import { tickSize } from "../src/core/market";
import { ETFS, PERIODS, build, f, stat } from "./lab";
import type { Rec } from "./lab";

const u = build(() => true);
const inv = new Map(u.recs.filter((r) => r.s === "1357.T" && Math.abs(r.intra) < 0.15).map((r) => [r.d, r.intra]));
const withStop = (r: Rec) => { const o = r.px * (1 + r.gap); return -r.lowPct >= 0.005 ? -0.005 - tickSize(o, true) / o : r.intra; };
const COST_1357 = 0.0003; // 1357 の往復の呼値ぶん（1円/約3,000円）
function run(name: string, hedgeYen: number, stop: boolean, hedgeIf: (longs: Rec[]) => boolean = (l) => l.length > 0) {
  const dl: [string, number][] = [];
  let hedged = 0;
  for (const d of u.days) {
    if (!inv.has(d)) continue;
    const longs = u.byDay.get(d)!.filter((x) => !ETFS.includes(x.s) && x.gap <= -0.01 && x.px * (1 + x.gap) * 100 <= 250000).sort((a, b) => a.gap - b.gap).slice(0, 2);
    let pnl = 0;
    for (const r of longs) { const o = r.px * (1 + r.gap); pnl += Math.floor(250000 / (o * 100)) * 100 * o * (stop ? withStop(r) : r.intra); }
    if (hedgeYen > 0 && hedgeIf(longs)) { pnl += hedgeYen * (longs.length / 2) * (inv.get(d)! - COST_1357); hedged++; }
    if (longs.length) dl.push([d, pnl]);
  }
  let peak = 0, cum = 0, dd = 0;
  for (const [, v] of dl) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  const st = stat(dl.map((x) => x[1]));
  const sorted = dl.map((x) => x[1]).sort((a, b) => a - b);
  const per = PERIODS.map(([lo, hi]) => { const v = dl.filter(([d]) => d >= lo && d < hi).map((x) => x[1]); return `${Math.round(v.reduce((a, b) => a + b, 0) / 1e4).toString().padStart(4)}万/t${f(stat(v).t, 5, 2)}`; }).join(" | ");
  console.log(`${name.padEnd(30)} ${String(dl.length).padStart(5)}日 合計${Math.round(cum / 1e4).toString().padStart(5)}万 t${f(st.t, 6, 2)} 最悪の日${Math.round(sorted[0]).toString().padStart(7)} 下位1%${Math.round(sorted[Math.floor(sorted.length * 0.01)]).toString().padStart(7)} 落ち込み${Math.round(dd / 1e4).toString().padStart(4)}万 | ${per}`);
}
for (const stop of [true, false]) {
  console.log(`\n=== 損切り${stop ? "0.5%あり" : "なし（引けまで持つ）"}`);
  run("ヘッジなし", 0, stop);
  for (const h of [62500, 125000, 250000]) run(`1357 を ${h / 1e4}万円`, h, stop);
}
// 1357 だけを同じ日に買った場合（ヘッジ自体の損益）
console.log("\n=== 参考: 安寄り買いの日に 1357 を25万円だけ買った場合");
{
  const v: number[] = [];
  for (const d of u.days) { if (!inv.has(d)) continue; if (u.byDay.get(d)!.some((x) => !ETFS.includes(x.s) && x.gap <= -0.01)) v.push(250000 * (inv.get(d)! - COST_1357)); }
  const st = stat(v);
  console.log(`  ${v.length}日 合計${Math.round(v.reduce((a, b) => a + b, 0) / 1e4)}万 t${f(st.t, 6, 2)}`);
}
