/**
 * 決算のあとの値動きは続くか。引け後に決算短信が出た翌朝のギャップで分け、その日の寄り／引けで買って
 * 数日持ったときの成績（相場平均に対する上乗せ）を見る。J-Quants の開示日（2024年9月〜2026年8月）。
 *   npx tsx scripts/lab-pead.ts
 *   npx tsx scripts/lab-pead.ts --dir .cachet   # 別の銘柄群（lab-jquants-fins.ts --dir .cachet で開示日を取ってから）
 */
import { existsSync, readFileSync } from "node:fs";
import { CACHE as DEFAULT_DIR, ETFS, build, f, hold, mean, stat } from "./lab";
import type { Rec } from "./lab";

const di = process.argv.indexOf("--dir");
const CACHE = di >= 0 ? process.argv[di + 1] : DEFAULT_DIR;
const u = build((s) => !ETFS.includes(s), CACHE);
interface Disc { d: string; t: string; type: string }
const fins = new Map<string, Disc[]>();
for (const s of new Set(u.recs.map((r) => r.s))) { const file = `${CACHE}/jq-fins-${s.slice(0, 4)}.json`; if (existsSync(file)) fins.set(s, (JSON.parse(readFileSync(file, "utf8")) as Disc[]).filter((x) => x.type.includes("FinancialStatements"))); }
const close = (d: string) => (d >= "2024-11-05" ? "15:30:00" : "15:00:00");
/** 前の営業日の大引けより後、当日の寄り前までに決算短信が出た日 */
const after = (r: Rec) => (fins.get(r.s) ?? []).some((x) => (x.d === r.pd && x.t >= close(r.pd)) || (x.d > r.pd && x.d < r.d) || (x.d === r.d && x.t < "09:00:00"));
/** 前の営業日の場中に決算短信が出た日（反応は前日の場中。前日の引けで買える） */
const intraPrev = (r: Rec) => (fins.get(r.s) ?? []).some((x) => x.d === r.pd && x.t >= "09:00:00" && x.t < close(r.pd));
const recs = u.recs.filter((r) => r.d >= "2024-09-02" && r.d <= "2026-08-28" && fins.has(r.s));
const ev = recs.filter(after), evI = recs.filter(intraPrev);
console.log(`引け後の決算の翌朝 ${ev.length}件、場中の決算の翌日 ${evI.length}件`);
/** 寄りで買って n 日目の引けで売る（n=1 は当日の引け）。[損益, 相場平均] */
const fromOpen = (n: number) => (r: Rec): [number, number] | null => { if (n === 1) return [r.intra, r.mktIntra]; if (!r.next) return null; const a = hold(r.next, n - 1), b = hold(r.next, n - 1, "mktC2c"); return a == null || b == null ? null : [(1 + r.intra) * (1 + a) - 1, (1 + r.mktIntra) * (1 + b) - 1]; };
/** 当日の引けで買って n 日後の引けで売る */
const fromClose = (n: number) => (r: Rec): [number, number] | null => { if (!r.next) return null; const a = hold(r.next, n), b = hold(r.next, n, "mktC2c"); return a == null || b == null ? null : [a, b]; };
function report(name: string, list: Rec[], fn: (r: Rec) => [number, number] | null) {
  const byDay = new Map<string, [number, number][]>();
  let n = 0, win = 0;
  for (const r of list) { const v = fn(r); if (!v) continue; n++; if (v[0] > 0) win++; const a = byDay.get(r.d); if (a) a.push(v); else byDay.set(r.d, [v]); }
  const raw = stat([...byDay.values()].map((v) => mean(v.map((x) => x[0])))), exc = stat([...byDay.values()].map((v) => mean(v.map((x) => x[0] - x[1]))));
  const h1 = [...byDay.entries()].filter(([d]) => d < "2025-09-01").map(([, v]) => mean(v.map((x) => x[0] - x[1]))), h2 = [...byDay.entries()].filter(([d]) => d >= "2025-09-01").map(([, v]) => mean(v.map((x) => x[0] - x[1])));
  console.log(`  ${name.padEnd(16)} ${String(n).padStart(5)}件 ${String(raw.n).padStart(3)}日 日平均${f(raw.m, 7)}bp t${f(raw.t, 6, 2)} 上乗せ${f(exc.m, 7)}bp t${f(exc.t, 6, 2)} 勝ち${f((win / Math.max(n, 1)) * 100, 4, 0)}% | 前半の上乗せ${f(stat(h1).m, 7)}/t${f(stat(h1).t, 5, 2)} 後半${f(stat(h2).m, 7)}/t${f(stat(h2).t, 5, 2)}`);
}
const GROUPS: [string, (r: Rec) => boolean][] = [["+5%以上で寄った", (r) => r.gap >= 0.05], ["+3%以上で寄った", (r) => r.gap >= 0.03], ["+1〜3%で寄った", (r) => r.gap >= 0.01 && r.gap < 0.03], ["±1%以内", (r) => Math.abs(r.gap) < 0.01], ["-1〜-3%で寄った", (r) => r.gap <= -0.01 && r.gap > -0.03], ["-3%以下で寄った", (r) => r.gap <= -0.03]];
for (const [g, cond] of GROUPS) {
  console.log(`\n=== 引け後の決算の翌朝、${g}`);
  for (const n of [1, 3, 5, 10, 20]) report(`寄りで買い${n}日目の引け`, ev.filter(cond), fromOpen(n));
  for (const n of [1, 3, 5, 10, 20]) report(`引けで買い${n}日後の引け`, ev.filter(cond), fromClose(n));
}
// 決算の日の値動き全体（前日終値→当日終値）で分け、引けで買う
console.log("\n######## 決算への反応の日の騰落（前日比）で分け、その日の引けで買う");
for (const [g, cond] of [["+5%以上で引けた", (r: Rec) => r.c2c >= 0.05], ["+3%以上で引けた", (r: Rec) => r.c2c >= 0.03], ["高く寄ってさらに上げた(寄り+1%,場中+)", (r: Rec) => r.gap >= 0.01 && r.intra > 0], ["高く寄って垂れた(寄り+1%,場中-)", (r: Rec) => r.gap >= 0.01 && r.intra < 0], ["-3%以下で引けた", (r: Rec) => r.c2c <= -0.03], ["-5%以下で引けた", (r: Rec) => r.c2c <= -0.05]] as const) {
  console.log(`=== ${g}`);
  for (const n of [1, 3, 5, 10, 20, 40]) report(`${n}日後の引け`, ev.filter(cond), fromClose(n));
}
console.log("\n######## 場中に決算が出た日の騰落（前日比）で分け、その日の引けで買う（rec は翌日なので pRet で分け、前日終値から持つ）");
const fromPrevClose = (n: number) => (r: Rec): [number, number] | null => { const a = hold(r, n), b = hold(r, n, "mktC2c"); return a == null || b == null ? null : [a, b]; };
for (const [g, cond] of [["+5%以上で引けた", (r: Rec) => r.pRet >= 0.05], ["+3%以上で引けた", (r: Rec) => r.pRet >= 0.03], ["-3%以下で引けた", (r: Rec) => r.pRet <= -0.03], ["-5%以下で引けた", (r: Rec) => r.pRet <= -0.05]] as const) {
  console.log(`=== ${g}`);
  for (const n of [1, 3, 5, 10, 20, 40]) report(`${n}日後の引け`, evI.filter(cond), fromPrevClose(n));
}
// 場中の好決算の翌日を、夜間（前日引け→寄り）と場中（寄り→引け）に分ける
console.log("\n######## 場中に決算が出て上げて引けた銘柄の翌日を、夜間と場中に分ける");
for (const [g, cond] of [["+3%以上で引けた", (r: Rec) => r.pRet >= 0.03], ["+5%以上で引けた", (r: Rec) => r.pRet >= 0.05], ["+3%以上（300円未満を除く）", (r: Rec) => r.pRet >= 0.03 && r.px >= 300], ["+1〜3%で引けた", (r: Rec) => r.pRet >= 0.01 && r.pRet < 0.03]] as const) {
  console.log(`=== ${g}`);
  report("夜間", evI.filter(cond), (r) => [r.gap, r.mktGap]);
  report("翌日の場中", evI.filter(cond), (r) => [r.intra, r.mktIntra]);
  report("翌日の引けまで", evI.filter(cond), (r) => [r.c2c, r.mktC2c]);
}
