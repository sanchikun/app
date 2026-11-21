/**
 * 損切りが想定どおりに約定するか。
 * 1) 日足10年: 候補1（前日2%以上下げた安寄り、最大ギャップの1銘柄、損切り0.5%）で、損切りの滑りを 1〜10 ティックに変えたときの成績。
 * 2) 5分足60日: 損切りにかかった時刻と、足と足のあいだで値が飛んで損切りの値より下で始まった割合・幅。
 * 5分足の中の値動きは分からないので、2) で測れるのは足の境目で飛んだ分だけ。
 */
import { existsSync, readFileSync } from "node:fs";
import { jstDate, tickSize } from "../src/core/market";
import type { Bar } from "../src/core/types";
import { CACHE, ETFS, PERIODS, build, f, mean, stat } from "./lab";
import type { Rec } from "./lab";

const u = build((s) => !ETFS.includes(s));
const STOP = 0.005;
const open = (r: Rec) => r.px * (1 + r.gap); // 配当落ち日は配当の分だけずれるが、ティックを決めるだけなので無視する
const tickBp = (r: Rec) => tickSize(open(r), true) / open(r);

console.log("=== 1) 損切りの滑りを変えたときの成績（日足10年、1日1銘柄、損切り0.5%）");
for (const [name, cand] of [["安寄り買い（条件なし）", (r: Rec) => r.gap <= -0.01], ["候補1（前日2%以上下げ）", (r: Rec) => r.gap <= -0.01 && r.pRet <= -0.02]] as const) {
  for (const k of [1, 2, 3, 5, 10, 20]) {
    const rets: [string, number][] = [];
    let stopped = 0, slipSum = 0;
    for (const d of u.days) {
      const c = u.byDay.get(d)!.filter(cand);
      if (!c.length) continue;
      const r = c.reduce((a, b) => (b.gap < a.gap ? b : a));
      if (r.lowPct <= -STOP) { stopped++; slipSum += k * tickBp(r); rets.push([d, -STOP - k * tickBp(r)]); } else rets.push([d, r.intra]);
    }
    const a = stat(rets.map((x) => x[1]));
    const per = PERIODS.map(([lo, hi]) => f(stat(rets.filter(([d]) => d >= lo && d < hi).map((x) => x[1])).m)).join(" /");
    console.log(`${name.padEnd(26)} 滑り${String(k).padStart(2)}ティック（平均${f((slipSum / stopped) * 1e4, 5)}bp） 損切り${f((stopped / rets.length) * 100, 4, 0)}%  1回平均${f(a.m)}bp t${f(a.t, 5, 2)}  期間ごと ${per}`);
  }
}

console.log("\n=== 2) 5分足60日: 前日2%以上下げた安寄り（全銘柄）で、損切り0.5%にかかった時刻と値の飛び");
const days5 = new Set<string>();
const bars5 = new Map<string, Map<string, Bar[]>>();
const get5 = (s: string) => {
  if (!bars5.has(s)) {
    const m = new Map<string, Bar[]>();
    const file = `${CACHE}/${s}-5m-60d.json`;
    if (existsSync(file)) for (const b of JSON.parse(readFileSync(file, "utf8")) as Bar[]) { const d = jstDate(b.t); days5.add(d); const a = m.get(d); if (a) a.push(b); else m.set(d, [b]); }
    bars5.set(s, m);
  }
  return bars5.get(s)!;
};
interface Hit { min: number; firstBar: boolean; jumped: boolean; beyond: number; assumed: number; real: number }
const hits: Hit[] = [];
let cases = 0, notStopped = 0, unseen = 0;
const assumedAll: number[] = [], realAll: number[] = [];
for (const r of u.recs) {
  if (!(r.gap <= -0.01 && r.pRet <= -0.02)) continue;
  const bars = get5(r.s).get(r.d);
  if (!bars || bars.length < 30) continue;
  cases++;
  const o = open(r), tick = tickSize(o, true), stop = Math.floor((o * (1 - STOP)) / tick + 1e-6) * tick;
  const assumed = (stop - tick - o) / o;
  if (r.lowPct * o + o > stop + 1e-9) { notStopped++; assumedAll.push(r.intra); realAll.push(r.intra); continue; }
  const i = bars.findIndex((b) => b.l <= stop + 1e-9);
  // 日足の安値は損切りに届いているのに5分足にはない日（分足に欠けている 9:00〜9:05 など）は、想定どおりとして数える
  if (i < 0) { unseen++; assumedAll.push(assumed); realAll.push(assumed); continue; }
  const b = bars[i], jumped = b.o < stop - 1e-9;
  const real = ((jumped ? b.o : stop) - tick - o) / o;
  const start = Date.parse(`${r.d}T00:00:00Z`) / 1000 - 9 * 3600;
  hits.push({ min: (b.t - start) / 60 - 540, firstBar: i === 0, jumped, beyond: jumped ? (stop - b.o) / o : 0, assumed, real });
  assumedAll.push(assumed); realAll.push(real);
}
console.log(`対象 ${cases}件（${[...days5].sort()[0]}〜${[...days5].sort().pop()}）  損切りにかからず ${notStopped}件  損切り ${hits.length + unseen}件（うち5分足で確認できない時間帯 ${unseen}件）`);
const share = (n: number) => `${f((n / hits.length) * 100, 4, 0)}%`;
console.log(`損切りの時刻: 最初の足まで ${share(hits.filter((h) => h.firstBar).length)}  9:30まで ${share(hits.filter((h) => h.min < 30).length)}  10:00まで ${share(hits.filter((h) => h.min < 60).length)}  前場のうち ${share(hits.filter((h) => h.min < 150).length)}`);
for (const [name, list] of [["最初の足（寄り付き直後。9:00〜9:05 の足は欠けていることが多い）", hits.filter((h) => h.firstBar)], ["2本目以降の足", hits.filter((h) => !h.firstBar)]] as const) {
  const j = list.filter((h) => h.jumped), bs = j.map((h) => h.beyond).sort((a, b) => a - b);
  console.log(`${name}: ${list.length}件  損切りの値より下で始まった足 ${j.length}件（${f((j.length / Math.max(list.length, 1)) * 100, 4, 0)}%）  その幅 平均${f(mean(bs.length ? bs : [0]) * 1e4)}bp 中央${f((bs[Math.floor(bs.length / 2)] ?? 0) * 1e4)}bp 上位10%${f((bs[Math.floor(bs.length * 0.9)] ?? 0) * 1e4)}bp 最大${f((bs[bs.length - 1] ?? 0) * 1e4)}bp`);
}
console.log(`全${cases}件の1回平均: 想定どおり約定 ${f(mean(assumedAll) * 1e4)}bp → 足の始値で約定したとすると ${f(mean(realAll) * 1e4)}bp（差 ${f((mean(realAll) - mean(assumedAll)) * 1e4)}bp）`);
const late = hits.filter((h) => !h.firstBar);
console.log(`2本目以降の足だけで見た損切り1回あたりの余分な損: ${f(mean(late.map((h) => h.real - h.assumed)) * 1e4)}bp`);
