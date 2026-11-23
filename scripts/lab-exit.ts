/**
 * 売る時刻と曜日を、ためてある5分足（data/intraday/5m）で見る。寄り値で買い、損切り0.5%は 9:05 から有効、決めた時刻の足の始値で売る。
 * 分足が毎週たまっていくので、ときどき動かして同じ形が続いているかを見る。
 *   npx tsx scripts/lab-fetch.ts && npx tsx scripts/lab-exit.ts
 */
import { tickSize } from "../src/core/market";
import { ETFS, build, f, mean, readArchive, stat } from "./lab";
import type { Rec } from "./lab";

const u = build((s) => !ETFS.includes(s));
const arch = readArchive("5m");
const minuteOf = (d: string, t: number) => (t - (Date.parse(`${d}T00:00:00Z`) / 1000 - 9 * 3600)) / 60;
interface Case { r: Rec; open: number; tick: number; bars: { t: number; o: number; l: number; h: number; c: number }[] }
const cases: Case[] = [];
for (const r of u.recs) {
  if (!(r.gap <= -0.01) || r.div > 0) continue;
  const bars = arch.get(r.s)?.get(r.d);
  if (!bars || bars.length < 30) continue;
  const open = r.px * (1 + r.gap);
  // 出来高ゼロで値幅のない 9:00 の足は置き物なので捨てる
  cases.push({ r, open, tick: tickSize(open, true), bars: bars.filter((b, i) => !(i === 0 && minuteOf(r.d, b.t) === 540 && b.h === b.l && b.v === 0)) });
}
const days = [...new Set(cases.map((c) => c.r.d))].sort();
console.log(`1%以上安く寄った ${cases.length}件、${days.length}日（${days[0]}〜${days[days.length - 1]}）`);
/** 損切りは from 分（9:00 から数えて）から、exit 分の足の始値で売る。exit が null なら最後の足の終値 */
function ret(c: Case, exit: number | null, from = 5, stopPct = 0.005): number {
  const stop = c.open * (1 - stopPct);
  for (const b of c.bars) {
    const m = minuteOf(c.r.d, b.t) - 540;
    if (exit != null && m >= exit) return (b.o - c.tick) / c.open - 1;
    if (m < from) continue;
    if (b.o <= stop) return (b.o - c.tick) / c.open - 1;
    if (b.l <= stop) return (stop - c.tick) / c.open - 1;
  }
  return c.bars[c.bars.length - 1].c / c.open - 1;
}
function top2(fn: (c: Case) => number, ok: (d: string) => boolean = () => true) {
  const dl: number[] = [];
  for (const d of days) {
    if (!ok(d)) continue;
    let pnl = 0;
    for (const c of cases.filter((x) => x.r.d === d && x.open * 100 <= 250000).sort((a, b) => a.r.gap - b.r.gap).slice(0, 2)) pnl += Math.floor(250000 / (c.open * 100)) * 100 * c.open * fn(c);
    dl.push(pnl);
  }
  let peak = 0, cum = 0, dd = 0;
  for (const v of dl) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  return `合計 ${Math.round(cum).toLocaleString("ja-JP").padStart(8)}円 t${f(stat(dl).t, 5, 2)} 勝ち日${f((dl.filter((x) => x > 0).length / Math.max(dl.length, 1)) * 100, 4, 0)}% 最悪の日 ${Math.round(Math.min(...dl, 0)).toLocaleString("ja-JP").padStart(7)} 落ち込み ${Math.round(dd).toLocaleString("ja-JP").padStart(8)}（${dl.length}日）`;
}
function all(fn: (c: Case) => number) {
  const byDay = new Map<string, number[]>();
  for (const c of cases) { const a = byDay.get(c.r.d); if (a) a.push(fn(c)); else byDay.set(c.r.d, [fn(c)]); }
  const st = stat([...byDay.values()].map(mean));
  return `全銘柄の日平均${f(st.m, 6)}bp t${f(st.t, 5, 2)}`;
}
const hhmm = (m: number) => `${Math.floor(9 + m / 60)}:${String(m % 60).padStart(2, "0")}`;
console.log("\n=== 売る時刻（損切り0.5%は 9:05 から。上位2銘柄×25万円）");
for (const m of [10, 15, 20, 30, 45, 60, 90, 120, 150, 215, 270, 330]) console.log(`  ${hhmm(m).padEnd(6)}に売る  ${all((c) => ret(c, m))}  | ${top2((c) => ret(c, m))}`);
console.log(`  引けまで持つ  ${all((c) => ret(c, null))}  | ${top2((c) => ret(c, null))}`);
console.log("\n=== 損切りの置き方（10:00 に売る）");
for (const [name, from, sp] of [["9:05 から 0.5%", 5, 0.005], ["9:05 から 1%", 5, 0.01], ["9:05 から 2%", 5, 0.02], ["9:15 から 0.5%", 15, 0.005], ["9:30 から 0.5%", 30, 0.005], ["損切りなし", 999, 0.005]] as const) console.log(`  ${name.padEnd(14)} ${all((c) => ret(c, 60, from, sp))}  | ${top2((c) => ret(c, 60, from, sp))}`);
console.log("\n=== 曜日ごと（損切り 9:05 から 0.5%、10:00 に売る。上位2銘柄×25万円）");
for (const [w, name] of [[1, "月"], [2, "火"], [3, "水"], [4, "木"], [5, "金"]] as const) console.log(`  ${name}曜  ${top2((c) => ret(c, 60), (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === w)}`);
