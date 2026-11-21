/**
 * 寄り付きの現実性。
 * 1) 寄りで買えなかったら: 寄り値ではなく、寄り付き後（9:05、9:10、9:15、9:30）に成行で買った場合の成績（5分足60日）。
 * 2) 寄り付きから5分間: 9:00 の足がある日（主に週の最初の営業日）で、損切りがどれだけ早く・どれだけ深く起きるか。
 *    1分足（直近7日）があれば、1分ごとの動きと、足の境目で値が飛んだ幅も見る。
 *   npx tsx scripts/lab-fetch.ts && npx tsx scripts/lab-fetch5m.ts && npx tsx scripts/lab-fetch1m.ts && npx tsx scripts/lab-open.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { jstDate, tickSize } from "../src/core/market";
import type { Bar } from "../src/core/types";
import { CACHE, ETFS, build, f, mean, stat } from "./lab";
import type { Rec } from "./lab";

const u = build((s) => !ETFS.includes(s));
function loadBars(s: string, kind: "5m-60d" | "1m-7d"): Map<string, Bar[]> {
  const m = new Map<string, Bar[]>();
  const file = `${CACHE}/${s}-${kind}.json`;
  if (existsSync(file)) for (const b of JSON.parse(readFileSync(file, "utf8")) as Bar[]) { const d = jstDate(b.t); const a = m.get(d); if (a) a.push(b); else m.set(d, [b]); }
  return m;
}
const cache5 = new Map<string, Map<string, Bar[]>>(), cache1 = new Map<string, Map<string, Bar[]>>();
const bars5 = (s: string) => cache5.get(s) ?? (cache5.set(s, loadBars(s, "5m-60d")), cache5.get(s)!);
const bars1 = (s: string) => cache1.get(s) ?? (cache1.set(s, loadBars(s, "1m-7d")), cache1.get(s)!);
const minuteOf = (d: string, t: number) => (t - (Date.parse(`${d}T00:00:00Z`) / 1000 - 9 * 3600)) / 60;
/** 出来高ゼロで値幅のない 9:00 の足は前日終値の置き物なので捨てる */
const real = (d: string, bars: Bar[]) => bars.filter((b, i) => !(i === 0 && minuteOf(d, b.t) === 540 && b.h === b.l && b.v === 0));
const openOf = (r: Rec) => r.px * (1 + r.gap);
const STOP = 0.005;

interface Case { r: Rec; bars: Bar[]; open: number; close: number; tick: number }
const cases: Case[] = [];
for (const r of u.recs) {
  if (!(r.gap <= -0.01) || r.div > 0) continue;
  const raw = bars5(r.s).get(r.d);
  if (!raw || raw.length < 30) continue;
  const open = openOf(r);
  cases.push({ r, bars: real(r.d, raw), open, close: open * (1 + r.intra), tick: tickSize(open, true) });
}
const days = [...new Set(cases.map((c) => c.r.d))].sort();
console.log(`1%以上安く寄った ${cases.length}件、${days.length}日（${days[0]}〜${days[days.length - 1]}）`);

/** 寄り値で買う（日足の安値で損切りを判定。これまでの検証と同じ） */
const atOpen = (c: Case) => (c.r.lowPct <= -STOP ? -STOP - c.tick / c.open : c.r.intra);
/** minute 分（9:00 からの分）以降で最初の足の始値に成行で買う。損切りは買値の0.5%下、足の始値が損切りより下ならその値で売れたとする */
function late(c: Case, minute: number, entrySlipTicks = 1): number | null {
  const i = c.bars.findIndex((b) => minuteOf(c.r.d, b.t) - 540 >= minute);
  if (i < 0) return null;
  const entry = c.bars[i].o + entrySlipTicks * c.tick, stop = c.bars[i].o * (1 - STOP);
  for (let k = i; k < c.bars.length; k++) {
    const b = c.bars[k];
    if (b.l <= stop) return (Math.min(stop, k === i ? stop : b.o) - c.tick) / entry - 1;
  }
  return c.close / entry - 1;
}
function report(name: string, fn: (c: Case) => number | null, pick: (c: Case) => boolean = () => true) {
  const byDay = new Map<string, number[]>();
  let n = 0, wins = 0;
  for (const c of cases) { if (!pick(c)) continue; const v = fn(c); if (v == null) continue; n++; if (v > 0) wins++; const a = byDay.get(c.r.d); if (a) a.push(v); else byDay.set(c.r.d, [v]); }
  const st = stat([...byDay.values()].map(mean));
  console.log(`  ${name.padEnd(44)} ${String(n).padStart(5)}件 ${String(st.n).padStart(3)}日  日平均${f(st.m, 7)}bp  t${f(st.t, 6, 2)}  勝ち${f((wins / Math.max(n, 1)) * 100, 4, 0)}%`);
}
console.log("\n=== 1) 買う時刻を変えたとき（全銘柄の日平均。損切り0.5%、引けで売る）");
report("寄り値で買う（これまでの前提）", atOpen);
for (const m of [5, 10, 15, 30, 60]) report(`9:${String(m).padStart(2, "0").replace("60", "60")} ごろ成行で買う（買いの滑り1ティック）`.replace("9:60", "10:00"), (c) => late(c, m));
report("9:05 ごろ買う（滑りなしとした場合）", (c) => late(c, 5, 0));
const move = (c: Case, minute: number) => { const b = c.bars.find((x) => minuteOf(c.r.d, x.t) - 540 >= minute); return b ? b.o / c.open - 1 : null; };
console.log("  寄り値から各時刻までの値動き:");
for (const m of [5, 10, 30]) report(`    寄り → 9:${String(m).padStart(2, "0")}`, (c) => move(c, m));
report("    9:05 → 引け（損切りなし）", (c) => { const b = c.bars.find((x) => minuteOf(c.r.d, x.t) - 540 >= 5); return b ? c.close / b.o - 1 : null; });
report("    寄り → 引け（損切りなし）", (c) => c.r.intra);
console.log("  9:05 の時点の値で分ける（9:05 に買う）:");
report("    寄り値より上にいる銘柄だけ買う", (c) => late(c, 5), (c) => (move(c, 5) ?? -1) > 0);
report("    寄り値以下にいる銘柄だけ買う", (c) => late(c, 5), (c) => (move(c, 5) ?? 1) <= 0);
report("    寄り値から0.5%以上下げた銘柄だけ買う", (c) => late(c, 5), (c) => (move(c, 5) ?? 1) <= -0.005);

/** 寄り値で買い、損切りは minute 分たってから有効にする。その時点ですでに損切りより下なら、その足の始値で売る */
function delayedStop(c: Case, minute: number, stopPct = STOP): number | null {
  const i = c.bars.findIndex((b) => minuteOf(c.r.d, b.t) - 540 >= minute);
  if (i < 0) return null;
  const stop = c.open * (1 - stopPct);
  for (let k = i; k < c.bars.length; k++) {
    const b = c.bars[k];
    if (b.o <= stop) return (b.o - c.tick) / c.open - 1;
    if (b.l <= stop) return (stop - c.tick) / c.open - 1;
  }
  return c.close / c.open - 1;
}
console.log("  寄り値で買い、損切りを有効にする時刻を遅らせる:");
for (const m of [5, 10, 15, 30]) report(`    損切り0.5%を 9:${String(m).padStart(2, "0")} から有効にする`, (c) => delayedStop(c, m));
for (const m of [5, 10]) report(`    損切り1%を 9:${String(m).padStart(2, "0")} から有効にする`, (c) => delayedStop(c, m, 0.01));
report("    損切りなし", (c) => c.r.intra);

console.log("\n  ギャップの大きい順に2銘柄×25万円（円、60日の合計）:");
for (const [name, fn] of [["寄り値で買う", atOpen], ["9:05 ごろ成行で買う", (c: Case) => late(c, 5)], ["9:10 ごろ成行で買う", (c: Case) => late(c, 10)], ["9:30 ごろ成行で買う", (c: Case) => late(c, 30)]] as const) {
  let total = 0; const dl: number[] = [];
  for (const d of days) {
    let pnl = 0;
    for (const c of cases.filter((x) => x.r.d === d && x.open * 100 <= 250000).sort((a, b) => a.r.gap - b.r.gap).slice(0, 2)) { const v = fn(c); if (v != null) pnl += Math.floor(250000 / (c.open * 100)) * 100 * c.open * v; }
    total += pnl; dl.push(pnl);
  }
  console.log(`    ${name.padEnd(20)} 合計 ${Math.round(total).toLocaleString("ja-JP").padStart(9)}円  t${f(stat(dl).t, 5, 2)}  勝ち日 ${f((dl.filter((x) => x > 0).length / dl.length) * 100, 3, 0)}%`);
}

console.log("\n=== 2) 寄り付きから5分間（9:00 の足がある日だけ）");
const first = cases.filter((c) => c.bars.length && minuteOf(c.r.d, c.bars[0].t) === 540);
const fdays = [...new Set(first.map((c) => c.r.d))].sort();
const match = first.filter((c) => Math.abs(c.bars[0].o / c.open - 1) < 0.0005);
console.log(`  ${first.length}件、${fdays.length}日（${fdays.join(" ")}）。5分足の始値が日足の始値と一致 ${match.length}件（以下は一致した分だけ）`);
const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const dip = match.map((c) => c.bars[0].l / c.open - 1).sort((a, b) => a - b);
console.log(`  最初の5分間の安値（寄り値比）: 中央${f(q(dip, 0.5) * 100, 6, 2)}% 下位25%${f(q(dip, 0.25) * 100, 6, 2)}% 下位10%${f(q(dip, 0.1) * 100, 6, 2)}% 最悪${f(dip[0] * 100, 6, 2)}%`);
for (const s of [0.003, 0.005, 0.01]) {
  const hit = match.filter((c) => c.bars[0].l <= c.open * (1 - s));
  const allStop = match.filter((c) => c.r.lowPct <= -s);
  const over = hit.map((c) => (c.open * (1 - s) - c.bars[0].l) / c.open).sort((a, b) => a - b);
  const rec = hit.filter((c) => c.bars[0].c > c.open * (1 - s));
  console.log(`  損切り${s * 100}%: その日に損切り ${allStop.length}件（${f((allStop.length / match.length) * 100, 3, 0)}%）、うち最初の5分で ${hit.length}件（${f((hit.length / Math.max(allStop.length, 1)) * 100, 3, 0)}%）。5分間の安値は損切りの値よりさらに 中央${f(q(over, 0.5) * 1e4, 5)}bp 上位10%${f(q(over, 0.9) * 1e4, 5)}bp 下。5分後に損切りの値より上に戻っていた ${rec.length}件（${f((rec.length / Math.max(hit.length, 1)) * 100, 3, 0)}%）`);
}

// 1分足
const c1: { c: Case; m: Bar[] }[] = [];
for (const c of cases) { const raw = bars1(c.r.s).get(c.r.d); if (!raw) continue; const m = real(c.r.d, raw); if (m.length && minuteOf(c.r.d, m[0].t) === 540 && Math.abs(m[0].o / c.open - 1) < 0.0005) c1.push({ c, m }); }
console.log(`\n  1分足で 9:00 から見られる: ${c1.length}件（${[...new Set(c1.map((x) => x.c.r.d))].sort().join(" ")}）`);
if (c1.length) {
  for (const s of [0.003, 0.005]) {
    const mins: number[] = [], jump: number[] = [], within: number[] = [];
    let stops = 0;
    for (const { c, m } of c1) {
      const stop = c.open * (1 - s), i = m.findIndex((b) => b.l <= stop);
      if (i < 0) continue;
      stops++;
      mins.push(minuteOf(c.r.d, m[i].t) - 540);
      // 足の始値がすでに損切りより下なら、足の境目で値が飛んでいる
      if (i > 0 && m[i].o < stop) jump.push((stop - m[i].o) / c.open);
      within.push((stop - m[i].l) / c.open);
    }
    mins.sort((a, b) => a - b); within.sort((a, b) => a - b);
    console.log(`  損切り${s * 100}%: ${stops}件。かかった時刻: 最初の1分 ${mins.filter((x) => x < 1).length}件、3分以内 ${mins.filter((x) => x < 3).length}件、5分以内 ${mins.filter((x) => x < 5).length}件、30分以内 ${mins.filter((x) => x < 30).length}件。1分足の境目で値が飛んだ ${jump.length}件（平均${f(mean(jump.length ? jump : [0]) * 1e4, 5)}bp）。かかった1分間の安値は損切りの値より 中央${f(q(within, 0.5) * 1e4, 5)}bp 上位10%${f(q(within, 0.9) * 1e4, 5)}bp 下`);
  }
  const fm = c1.map(({ c, m }) => m[0].l / c.open - 1).sort((a, b) => a - b);
  const tk = c1.map(({ c }) => c.tick / c.open);
  console.log(`  最初の1分間の安値（寄り値比）: 中央${f(q(fm, 0.5) * 100, 6, 2)}% 下位25%${f(q(fm, 0.25) * 100, 6, 2)}% 下位10%${f(q(fm, 0.1) * 100, 6, 2)}%   1ティックは平均${f(mean(tk) * 1e4, 5)}bp`);
}
