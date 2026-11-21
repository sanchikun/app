/**
 * 安寄り買いのもうけが1日のどこで出ているかを、1時間足2年分で見る（寄り→10時 と 10時→引け に分ける）。
 *   npx tsx scripts/lab-fetch1h.ts && npx tsx scripts/lab-open1h.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { jstDate } from "../src/core/market";
import type { Bar } from "../src/core/types";
import { CACHE, ETFS, build, f, mean, stat } from "./lab";
import type { Rec } from "./lab";

const u = build((s) => !ETFS.includes(s));
const cache = new Map<string, Map<string, Bar[]>>();
function hours(s: string): Map<string, Bar[]> {
  if (!cache.has(s)) {
    const m = new Map<string, Bar[]>();
    const file = `${CACHE}/${s}-1h-730d.json`;
    if (existsSync(file)) for (const b of JSON.parse(readFileSync(file, "utf8")) as Bar[]) { const d = jstDate(b.t); const a = m.get(d); if (a) a.push(b); else m.set(d, [b]); }
    cache.set(s, m);
  }
  return cache.get(s)!;
}
interface Case { r: Rec; open: number; p10: number; close: number; low1: number; high1: number }
const all: Case[] = [];
let mismatch = 0, seen = 0;
for (const r of u.recs) {
  if (Math.abs(r.gap) < 0.01 || r.div > 0) continue;
  const bars = hours(r.s).get(r.d);
  if (!bars || bars.length < 5) continue;
  const b = bars[0], st = Date.parse(`${r.d}T00:00:00Z`) / 1000 - 9 * 3600;
  if ((b.t - st) / 3600 !== 9) continue;
  seen++;
  const open = r.px * (1 + r.gap);
  // 1時間足の最初の足は 9:05 から始まる日が多く、始値が日足と合わない。寄り値は日足のものを使い、足の終値（10時の値）だけを使う
  if (Math.abs(b.o / open - 1) > 0.001) mismatch++;
  all.push({ r, open, p10: b.c, close: open * (1 + r.intra), low1: b.l, high1: b.h });
}
const days = [...new Set(all.map((c) => c.r.d))].sort();
console.log(`1%以上のギャップ ${all.length}件、${days.length}日（${days[0]}〜${days[days.length - 1]}）。1時間足の始値が日足の始値と0.1%以上違う ${mismatch}/${seen}件（寄り値は日足を使用）`);
const YEARS: [string, (d: string) => boolean][] = [["全体", () => true], ["前半", (d) => d < days[Math.floor(days.length / 2)]], ["後半", (d) => d >= days[Math.floor(days.length / 2)]]];
function report(name: string, list: Case[], fn: (c: Case) => number) {
  const cells = YEARS.map(([, ok]) => {
    const byDay = new Map<string, number[]>();
    for (const c of list) { if (!ok(c.r.d)) continue; const a = byDay.get(c.r.d); if (a) a.push(fn(c)); else byDay.set(c.r.d, [fn(c)]); }
    const st = stat([...byDay.values()].map(mean));
    return `${f(st.m, 6)}bp/t${f(st.t, 5, 2)}(${String(st.n).padStart(3)}日)`;
  });
  console.log(`  ${name.padEnd(36)} ${cells.join("  ")}`);
}
console.log(`  表: 日平均bp / t値（日数）を ${YEARS.map((y) => y[0]).join("、")} の順に`);
for (const [title, list, dir] of [["1%以上安く寄った銘柄を買う", all.filter((c) => c.r.gap <= -0.01), 1], ["1%以上高く寄った銘柄を売る", all.filter((c) => c.r.gap >= 0.01), -1]] as const) {
  console.log(`\n=== ${title}（${list.length}件）`);
  report("寄り → 引け", list, (c) => dir * (c.close / c.open - 1));
  report("寄り → 10時", list, (c) => dir * (c.p10 / c.open - 1));
  report("10時 → 引け", list, (c) => dir * (c.close / c.p10 - 1));
  const top = (n: number) => { const out: Case[] = []; for (const d of days) out.push(...list.filter((c) => c.r.d === d).sort((a, b) => dir * (a.r.gap - b.r.gap)).slice(0, n)); return out; };
  const t2 = top(2);
  report("ギャップ上位2銘柄: 寄り → 引け", t2, (c) => dir * (c.close / c.open - 1));
  report("ギャップ上位2銘柄: 寄り → 10時", t2, (c) => dir * (c.p10 / c.open - 1));
  report("ギャップ上位2銘柄: 10時 → 引け", t2, (c) => dir * (c.close / c.p10 - 1));
  const adverse = (c: Case) => (dir === 1 ? 1 - c.low1 / c.open : c.high1 / c.open - 1);
  console.log(`  最初の1時間に寄り値から0.5%以上逆行した: ${f((list.filter((c) => adverse(c) >= 0.005).length / list.length) * 100, 4, 0)}%  その日のうちに0.5%以上逆行した: ${f((list.filter((c) => (dir === 1 ? -c.r.lowPct : c.r.highPct) >= 0.005).length / list.length) * 100, 4, 0)}%`);
}

// ---- 売る時刻と損切りの組み合わせ（安く寄った上位2銘柄×25万円、100株単位、円）
console.log("\n=== 安く寄った上位2銘柄×25万円: 売り方を変える（2年、円）");
const longs = all.filter((c) => c.r.gap <= -0.01 && c.open * 100 <= 250000);
const picks: Case[] = [];
for (const d of days) picks.push(...longs.filter((c) => c.r.d === d).sort((a, b) => a.r.gap - b.r.gap).slice(0, 2));
function yenReport(name: string, fn: (c: Case) => number) {
  const byDay = new Map<string, number>();
  for (const c of picks) byDay.set(c.r.d, (byDay.get(c.r.d) ?? 0) + Math.floor(250000 / (c.open * 100)) * 100 * c.open * fn(c));
  const dl = days.map((d) => byDay.get(d) ?? 0);
  let peak = 0, cum = 0, dd = 0;
  for (const v of dl) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  const m = new Map<string, number>();
  days.forEach((d, i) => m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + dl[i]));
  const mv = [...m.values()].sort((a, b) => a - b);
  console.log(`  ${name.padEnd(40)} 合計 ${Math.round(cum).toLocaleString("ja-JP").padStart(9)}円  t${f(stat(dl.filter((x) => x !== 0)).t, 5, 2)}  プラスの月 ${f((mv.filter((v) => v > 0).length / mv.length) * 100, 3, 0)}%  最悪の月 ${Math.round(mv[0]).toLocaleString("ja-JP").padStart(8)}  最悪の日 ${Math.round(Math.min(...dl)).toLocaleString("ja-JP").padStart(8)}  最大の落ち込み ${Math.round(dd).toLocaleString("ja-JP").padStart(9)}`);
}
const tk = 0.0003;
yenReport("引けで売る・損切り0.5%（今の予定）", (c) => (c.r.lowPct <= -0.005 ? -0.005 - tk : c.r.intra));
yenReport("引けで売る・損切りなし", (c) => c.r.intra);
yenReport("10時に売る・損切りなし", (c) => c.p10 / c.open - 1 - tk);
yenReport("10時に売る・損切り0.5%", (c) => (c.low1 / c.open - 1 <= -0.005 ? -0.005 - tk : c.p10 / c.open - 1 - tk));
yenReport("10時に売る・損切り1%", (c) => (c.low1 / c.open - 1 <= -0.01 ? -0.01 - tk : c.p10 / c.open - 1 - tk));
yenReport("10時に売る・損切り2%", (c) => (c.low1 / c.open - 1 <= -0.02 ? -0.02 - tk : c.p10 / c.open - 1 - tk));
yenReport("10時に売る・損切り0.5%・滑り3ティック", (c) => (c.low1 / c.open - 1 <= -0.005 ? -0.005 - 3 * tk : c.p10 / c.open - 1 - tk));
yenReport("10時に売る・損切り2%・滑り3ティック", (c) => (c.low1 / c.open - 1 <= -0.02 ? -0.02 - 3 * tk : c.p10 / c.open - 1 - 3 * tk));
