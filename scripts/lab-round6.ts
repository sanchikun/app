/**
 * 6巡目: (A) 日経平均・ドル円の状態との関係、(B) 損切り・利確の置き方。
 *   npx tsx scripts/lab-round6.ts
 * (A) 日経平均は前日の引けまで、ドル円は当日の寄り付き前までの値だけを使う。
 * (B) 1日1銘柄（最大ギャップ）で数える。日足では、同じ日に損切りと利確の両方に届いたときの順番が分からないので、
 *     「損切りが先」（厳しめ）と「利確が先」（甘め）の両方を出す。本当の成績はその間にある。
 */
import { readFileSync } from "node:fs";
import type { DailyBar } from "../src/core/gapstudy";
import { CACHE, ETFS, PERIODS, build, f, stat, tester } from "./lab";
import type { Rec } from "./lab";
import { secOf } from "./lab-sectors";

const u = build((s) => !ETFS.includes(s));
const T = tester(u);
const gd = (r: Rec) => r.gap <= -0.01;
const c1 = (r: Rec) => gd(r) && r.pRet <= -0.02;

// ---- 日経平均の状態（日付 d の前日の引けまで）----
interface Nk { r1: number; r5: number; ma25: number; ma200: number }
const nkBars = (JSON.parse(readFileSync(`${CACHE}/_N225-1d-10y.json`, "utf8")) as DailyBar[]).filter((b) => b.c > 0);
const nkDates = nkBars.map((b) => b.date);
const nkCache = new Map<string, Nk | null>();
function nk(d: string): Nk | null {
  if (nkCache.has(d)) return nkCache.get(d)!;
  let lo = 0, hi = nkDates.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (nkDates[m] < d) lo = m + 1; else hi = m; }
  const i = lo - 1; // d より前の最後の足
  let v: Nk | null = null;
  if (i >= 200) {
    let s25 = 0, s200 = 0;
    for (let k = 0; k < 200; k++) { s200 += nkBars[i - k].c; if (k < 25) s25 += nkBars[i - k].c; }
    v = { r1: nkBars[i].c / nkBars[i - 1].c - 1, r5: nkBars[i].c / nkBars[i - 5].c - 1, ma25: nkBars[i].c / (s25 / 25) - 1, ma200: nkBars[i].c / (s200 / 200) - 1 };
  }
  nkCache.set(d, v);
  return v;
}
const N = (r: Rec, g: (n: Nk) => boolean) => { const n = nk(r.d); return !!n && g(n); };

/** 1日1銘柄: 条件に合う中でギャップ最大の1銘柄。exit が損益率を返す */
type Exit = (r: Rec) => number;
const stopAt = (stop: number): Exit => (r) => (stop > 0 && r.lowPct <= -stop ? -stop - 0.0003 : r.intra);
function pick(name: string, cand: (r: Rec) => boolean, exit: Exit = stopAt(0.005)) {
  const dayRet: [string, number][] = [];
  for (const d of u.days) {
    const c = u.byDay.get(d)!.filter(cand);
    if (!c.length) continue;
    const r = c.reduce((a, b) => (b.gap < a.gap ? b : a));
    dayRet.push([d, exit(r)]);
  }
  const x = dayRet.map((v) => v[1]);
  const a = stat(x);
  const per = PERIODS.map(([lo, hi]) => { const p = stat(dayRet.filter(([d]) => d >= lo && d < hi).map((v) => v[1])); return `${f(p.m)}/${f(p.t, 5, 2)}(${String(p.n).padStart(3)})`; }).join(" |");
  let eq = 0, peak = 0, dd = 0;
  for (const v of x) { eq += v; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  console.log(`${name.padEnd(46)} d${String(a.n).padStart(5)} bp${f(a.m)} t${f(a.t, 6, 2)} 勝率${f((x.filter((v) => v > 0).length / Math.max(a.n, 1)) * 100, 4, 0)}% 合計${f(eq * 100, 6, 0)}% 最大DD${f(dd * 100, 6, 1)}% |${per}`);
}

console.log("=== A1 日経平均の状態 × 安寄り買い（全取引の場中、上乗せも見る）");
const nkConds: [string, (n: Nk) => boolean][] = [
  ["日経 前日 -1.5%以下", (n) => n.r1 <= -0.015], ["日経 前日 -1%以下", (n) => n.r1 <= -0.01], ["日経 前日 -1〜0%", (n) => n.r1 > -0.01 && n.r1 <= 0], ["日経 前日 0〜+1%", (n) => n.r1 > 0 && n.r1 < 0.01], ["日経 前日 +1%以上", (n) => n.r1 >= 0.01], ["日経 前日 +1.5%以上", (n) => n.r1 >= 0.015],
  ["日経 5日 -3%以下", (n) => n.r5 <= -0.03], ["日経 5日 -2%以下", (n) => n.r5 <= -0.02], ["日経 5日 ±2%以内", (n) => Math.abs(n.r5) < 0.02], ["日経 5日 +2%以上", (n) => n.r5 >= 0.02], ["日経 5日 +3%以上", (n) => n.r5 >= 0.03],
  ["日経 25日線より上", (n) => n.ma25 > 0], ["日経 25日線より下", (n) => n.ma25 <= 0], ["日経 25日線 -3%以下", (n) => n.ma25 <= -0.03], ["日経 25日線 +3%以上", (n) => n.ma25 >= 0.03],
  ["日経 200日線より上", (n) => n.ma200 > 0], ["日経 200日線より下", (n) => n.ma200 <= 0],
];
for (const [name, g] of nkConds) T(`gap<=-1 & ${name}`, "intra", (r) => gd(r) && N(r, g));
console.log("--- 1日1銘柄（最大ギャップ、損切り0.5%）: 上が条件なしの安寄り、下が候補1");
for (const [name, g] of nkConds) { pick(`${name}`, (r) => gd(r) && N(r, g)); pick(`${name} 候補1`, (r) => c1(r) && N(r, g)); }
console.log("--- 個別株が日経より弱かった／強かった翌日（候補1の「前日2%下げ」が相場ぐるみか自分だけか）");
for (const x of [0.01, 0.02]) {
  pick(`候補1 & 前日は相場より ${x * 100}%以上弱い`, (r) => c1(r) && r.pRet - r.mktPRet <= -x);
  pick(`候補1 & 前日は相場並み（差が ${x * 100}%未満）`, (r) => c1(r) && r.pRet - r.mktPRet > -x);
}
for (const x of [0.01, 0.015]) { pick(`候補1 & 前日は相場全体が -${x * 100}%以下`, (r) => c1(r) && r.mktPRet <= -x); pick(`候補1 & 前日の相場全体は -${x * 100}%より上`, (r) => c1(r) && r.mktPRet > -x); }

console.log("=== A2 ドル円（寄り付き前までの前日比。プラスが円安）");
const EXPORT = new Set(["自動車", "電機", "機械"]), DOMESTIC = new Set(["食品", "医薬", "運輸公益", "不動産建設", "商社小売", "情報サービス"]);
const ex = (r: Rec) => EXPORT.has(secOf.get(r.s) ?? ""), dm = (r: Rec) => DOMESTIC.has(secOf.get(r.s) ?? "");
for (const x of [0.005, 0.0075, 0.01]) {
  T(`円安 +${x * 100}%以上: 輸出株の場中`, "intra", (r) => r.jpy >= x && ex(r));
  T(`円安 +${x * 100}%以上: 内需株の場中`, "intra", (r) => r.jpy >= x && dm(r));
  T(`円高 -${x * 100}%以下: 輸出株の場中`, "intra", (r) => r.jpy <= -x && ex(r));
  T(`円高 -${x * 100}%以下: 内需株の場中`, "intra", (r) => r.jpy <= -x && dm(r));
}
for (const x of [0.005, 0.01]) {
  T(`円高 -${x * 100}%以下 & 輸出株 & gap<=-1`, "intra", (r) => r.jpy <= -x && ex(r) && gd(r));
  T(`円高 -${x * 100}%以下 & 内需株 & gap<=-1`, "intra", (r) => r.jpy <= -x && dm(r) && gd(r));
  T(`円安 +${x * 100}%以上 & 輸出株 & gap>=+1（高寄り）`, "intra", (r) => r.jpy >= x && ex(r) && r.gap >= 0.01);
}
console.log("--- 1日1銘柄（候補1、損切り0.5%）をドル円で分ける");
for (const [name, g] of [["円高 -1%以下", (j: number) => j <= -0.01], ["円高 -0.5%以下", (j: number) => j <= -0.005], ["±0.5%以内", (j: number) => Math.abs(j) < 0.005], ["円安 +0.5%以上", (j: number) => j >= 0.005], ["円安 +1%以上", (j: number) => j >= 0.01]] as [string, (j: number) => boolean][]) {
  pick(`候補1 & ${name}`, (r) => c1(r) && g(r.jpy));
  pick(`候補1 & ${name} & 輸出株だけ`, (r) => c1(r) && g(r.jpy) && ex(r));
  pick(`候補1 & ${name} & 内需株だけ`, (r) => c1(r) && g(r.jpy) && dm(r));
}
console.log("--- ETF の場中をドル円で分ける");
for (const s of ["1306.T", "1321.T"]) {
  const E = tester(build((x) => x === s));
  for (const x of [0.005, 0.01]) { E(`${s} 円安 +${x * 100}%以上`, "intra", (r) => r.jpy >= x); E(`${s} 円高 -${x * 100}%以下`, "intra", (r) => r.jpy <= -x); }
}
console.log("--- 日経平均とTOPIXの差（前日に日経ETFがTOPIX ETFより強かった／弱かった翌日の、日経ETF − TOPIX ETF）");
{
  const a = new Map(build((x) => x === "1321.T").recs.map((r) => [r.d, r])), b = new Map(build((x) => x === "1306.T").recs.map((r) => [r.d, r]));
  for (const x of [0.003, 0.005, 0.0075]) for (const sign of [1, -1]) {
    const rows: [string, number][] = [];
    for (const [d, r] of a) { const t = b.get(d); if (t && sign * (r.pRet - t.pRet) >= x) rows.push([d, r.c2c - t.c2c]); }
    const st = stat(rows.map((v) => v[1]));
    console.log(`前日 日経−TOPIX ${sign > 0 ? ">=+" : "<=-"}${x * 100}%`.padEnd(40) + ` d${String(st.n).padStart(5)} 翌日の差 bp${f(st.m)} t${f(st.t, 6, 2)} |` + PERIODS.map(([lo, hi]) => { const p = stat(rows.filter(([d]) => d >= lo && d < hi).map((v) => v[1])); return `${f(p.m)}/${f(p.t, 5, 2)}`; }).join(" |"));
  }
}

// ---- B 損切り・利確 ----
console.log("=== B1 損切りの幅（1日1銘柄、最大ギャップ）: 条件なしの安寄り／候補1");
for (const [tag, cand] of [["安寄り", gd], ["候補1", c1]] as [string, (r: Rec) => boolean][]) {
  for (const s of [0.002, 0.003, 0.004, 0.005, 0.006, 0.0075, 0.01, 0.015, 0.02, 0.03, 0]) pick(`${tag} 損切り ${s ? `${(s * 100).toFixed(2)}%` : "なし"}`, cand, stopAt(s));
}
console.log("=== B2 損切りを値動きの大きさに合わせる（k × 14日の平均値幅）／ギャップの大きさに合わせる（k × ギャップ）");
for (const k of [0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 0.75]) pick(`候補1 損切り ${k}×平均値幅`, c1, (r) => stopAt(Math.max(0.001, k * r.atr))(r));
for (const k of [0.15, 0.25, 0.35, 0.5, 0.75, 1]) pick(`候補1 損切り ${k}×ギャップ`, c1, (r) => stopAt(Math.max(0.001, k * -r.gap))(r));
console.log("=== B3 利確を置く（損切り0.5%）: 厳=同じ日に両方届いたら損切りが先、甘=利確が先");
const withTarget = (stop: number, target: (r: Rec) => number, stopFirst: boolean): Exit => (r) => {
  const t = target(r), hitS = stop > 0 && r.lowPct <= -stop, hitT = r.highPct >= t + 0.0003;
  if (hitS && hitT) return stopFirst ? -stop - 0.0003 : t;
  if (hitS) return -stop - 0.0003;
  return hitT ? t : r.intra;
};
for (const [tag, cand] of [["安寄り", gd], ["候補1", c1]] as [string, (r: Rec) => boolean][]) {
  pick(`${tag} 利確なし（比較用）`, cand);
  for (const t of [0.005, 0.01, 0.015, 0.02, 0.03, 0.05]) { pick(`${tag} 利確 +${t * 100}% 厳`, cand, withTarget(0.005, () => t, true)); pick(`${tag} 利確 +${t * 100}% 甘`, cand, withTarget(0.005, () => t, false)); }
  for (const k of [0.5, 1]) { pick(`${tag} 利確 ギャップの${k * 100}%を戻したら 厳`, cand, withTarget(0.005, (r) => Math.max(0.002, k * -r.gap), true)); pick(`${tag} 利確 ギャップの${k * 100}%を戻したら 甘`, cand, withTarget(0.005, (r) => Math.max(0.002, k * -r.gap), false)); }
  for (const k of [0.5, 1, 1.5]) { pick(`${tag} 利確 ${k}×平均値幅 厳`, cand, withTarget(0.005, (r) => k * r.atr, true)); pick(`${tag} 利確 ${k}×平均値幅 甘`, cand, withTarget(0.005, (r) => k * r.atr, false)); }
}
console.log("--- 損切りなしで利確だけ（順番の問題がない）");
for (const t of [0.01, 0.02, 0.03]) pick(`候補1 損切りなし 利確 +${t * 100}%`, c1, withTarget(0, () => t, true));
console.log("=== B4 損切りにかかった日と、かからなかった日（候補1、損切り0.5%）");
{
  const rows: Rec[] = [];
  for (const d of u.days) { const c = u.byDay.get(d)!.filter(c1); if (c.length) rows.push(c.reduce((a, b) => (b.gap < a.gap ? b : a))); }
  const hit = rows.filter((r) => r.lowPct <= -0.005), safe = rows.filter((r) => r.lowPct > -0.005);
  const m = (a: number[]) => f((a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1)) * 1e4);
  console.log(`損切りにかかった日 ${hit.length}（${f((hit.length / rows.length) * 100, 4, 0)}%）: そのまま引けまで持つと平均 ${m(hit.map((r) => r.intra))}bp、引けがプラスだった割合 ${f((hit.filter((r) => r.intra > 0).length / hit.length) * 100, 4, 0)}%`);
  console.log(`かからなかった日 ${safe.length}: 引けまでの平均 ${m(safe.map((r) => r.intra))}bp、途中の高値の平均 ${m(safe.map((r) => r.highPct))}bp`);
  for (const [lo, hi] of PERIODS) { const h = hit.filter((r) => r.d >= lo && r.d < hi), a = rows.filter((r) => r.d >= lo && r.d < hi); console.log(`  ${lo}〜: 損切りにかかる割合 ${f((h.length / a.length) * 100, 4, 0)}%、かかった日を引けまで持つと ${m(h.map((r) => r.intra))}bp`); }
}

// ---- 追加: 「相場が弱いときほど効く」を、境目・VIX との重なり・年ごとで確かめる ----
console.log("=== A3 候補1 × 日経平均と25日線（1日1銘柄、損切り0.5%）: 境目を動かす、VIX と重ねる、年ごと");
for (const x of [-0.02, -0.01, 0, 0.01, 0.02]) { pick(`候補1 & 日経が25日線 ${x >= 0 ? "+" : ""}${x * 100}% 以下`, (r) => c1(r) && N(r, (n) => n.ma25 <= x)); pick(`候補1 & 日経が25日線 ${x >= 0 ? "+" : ""}${x * 100}% より上`, (r) => c1(r) && N(r, (n) => n.ma25 > x)); }
for (const [vn, vg] of [["VIX15以上", (r: Rec) => r.vix >= 15], ["VIX15未満", (r: Rec) => r.vix < 15]] as [string, (r: Rec) => boolean][]) {
  pick(`候補1 & ${vn} & 25日線より下`, (r) => c1(r) && vg(r) && N(r, (n) => n.ma25 <= 0));
  pick(`候補1 & ${vn} & 25日線より上`, (r) => c1(r) && vg(r) && N(r, (n) => n.ma25 > 0));
  pick(`候補1 & ${vn} & 日経5日 -2%以下`, (r) => c1(r) && vg(r) && N(r, (n) => n.r5 <= -0.02));
  pick(`候補1 & ${vn} & 日経5日 -2%より上`, (r) => c1(r) && vg(r) && N(r, (n) => n.r5 > -0.02));
}
pick("候補1 & 25日線より下 または 日経5日 -2%以下", (r) => c1(r) && N(r, (n) => n.ma25 <= 0 || n.r5 <= -0.02));
pick("候補1 & 25日線より上 かつ 日経5日 -2%より上", (r) => c1(r) && N(r, (n) => n.ma25 > 0 && n.r5 > -0.02));
pick("候補1 & 25日線より上 & 日経前日 +1%以上", (r) => c1(r) && N(r, (n) => n.ma25 > 0 && n.r1 >= 0.01));
for (let y = 2017; y <= 2026; y++) { pick(`${y} 25日線より下`, (r) => r.d.startsWith(String(y)) && c1(r) && N(r, (n) => n.ma25 <= 0)); pick(`${y} 25日線より上`, (r) => r.d.startsWith(String(y)) && c1(r) && N(r, (n) => n.ma25 > 0)); }
console.log("--- 損切りなしでも同じ向きか");
pick("候補1 & 25日線より下（損切りなし）", (r) => c1(r) && N(r, (n) => n.ma25 <= 0), stopAt(0));
pick("候補1 & 25日線より上（損切りなし）", (r) => c1(r) && N(r, (n) => n.ma25 > 0), stopAt(0));
pick("安寄り & 25日線より下（損切りなし）", (r) => gd(r) && N(r, (n) => n.ma25 <= 0), stopAt(0));
pick("安寄り & 25日線より上（損切りなし）", (r) => gd(r) && N(r, (n) => n.ma25 > 0), stopAt(0));
