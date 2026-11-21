/**
 * 月曜の引け→火曜の寄り（TOPIX ETF）がなぜ高いのかを調べる。
 *   npx tsx scripts/lab-fetch.ts && npx tsx scripts/lab-monday.ts
 * A) 米国株（S&P500）の曜日ごとの動き  B) 同じ夜の米国の動きで説明した残り  C) 月曜が祝日の週、火曜が祝日の週
 * D) 日経平均先物（CME、円建て）の1時間足で、夜のどの時間帯に上がっているか（2024年7月以降だけ）  E) 火曜の場中で戻すか
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { DailyBar } from "../src/core/gapstudy";
import { CACHE, f, stat } from "./lab";

const daily = (name: string) => JSON.parse(readFileSync(`${CACHE}/${name}-1d-10y.json`, "utf8")) as DailyBar[];
const dowOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const PER: [string, string, string][] = [["2017–19", "2017", "2020"], ["2020–22", "2020", "2023"], ["2023–", "2023", "2099"]];
const cell = (x: number[]) => { const s = stat(x); return `${f(s.m)}/${f(s.t, 5, 2)}(${String(s.n).padStart(3)})`; };
const row = (name: string, v: [string, number][]) => console.log(`${name.padEnd(30)} 全体 ${cell(v.map((x) => x[1]))} | ${PER.map(([, lo, hi]) => cell(v.filter(([d]) => d >= lo && d < hi).map((x) => x[1]))).join(" | ")}`);
console.log(`表の見方: 平均bp / t値 (回数)。期間は 全体 | ${PER.map((p) => p[0]).join(" | ")}`);

// ---- A) 米国株の曜日ごと
const sp = daily("_GSPC");
console.log("\n=== A) S&P500 の曜日ごとの動き（米国の日付）");
for (const [label, fn] of [["前日比", (i: number) => sp[i].c / sp[i - 1].c - 1], ["寄り→引け", (i: number) => sp[i].c / sp[i].o - 1], ["前日引け→寄り", (i: number) => sp[i].o / sp[i - 1].c - 1]] as const)
  for (let w = 1; w <= 5; w++) row(`S&P ${DOW[w]}曜 ${label}`, sp.map((b, i) => [b.date, i > 0 && dowOf(b.date) === w && b.o > 0 ? fn(i) : NaN] as [string, number]).filter((x) => !Number.isNaN(x[1])));

// ---- B) 日本の夜間を、同じ夜の米国の動きで説明する
const etf = daily("1306.T");
const spIdx = new Map(sp.map((b, i) => [b.date, i]));
/** 日本の日付 d の寄り付き前に終わっている直近の米国の営業日（＝その夜の米国市場） */
const usBefore = (d: string) => { let lo = 0, hi = sp.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sp[m].date < d) lo = m + 1; else hi = m; } return lo - 1; };
interface Night { d: string; pd: string; on: number; intra: number; usC2C: number; usIntra: number; usGap: number; fresh: boolean; calGap: number; prevCalGap: number }
const nights: Night[] = [];
for (let i = 2; i < etf.length; i++) {
  const b = etf[i], p = etf[i - 1];
  const pc = p.c - (b.dividend ?? 0), on = b.o / pc - 1;
  if (!(b.o > 0) || Math.abs(on) > 0.2 || Math.abs(b.c / b.o - 1) > 0.2) continue;
  const k = usBefore(b.date);
  if (k < 1) continue;
  // fresh: その米国の営業日が、日本の前営業日の引けより後に始まっている（＝この夜のあいだの米国市場）
  nights.push({ d: b.date, pd: p.date, on, intra: b.c / b.o - 1, usC2C: sp[k].c / sp[k - 1].c - 1, usIntra: sp[k].c / sp[k].o - 1, usGap: sp[k].o / sp[k - 1].c - 1, fresh: sp[k].date >= p.date, calGap: (Date.parse(b.date) - Date.parse(p.date)) / 864e5, prevCalGap: (Date.parse(p.date) - Date.parse(etf[i - 2].date)) / 864e5 });
}
function ols(y: number[], xs: number[][]): number[] {
  // 正規方程式（定数項つき、説明変数は1〜2個）
  const n = y.length, k = xs.length + 1, X = y.map((_, i) => [1, ...xs.map((x) => x[i])]);
  const A = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => X.reduce((s, r) => s + r[a] * r[b], 0)));
  const B = Array.from({ length: k }, (_, a) => X.reduce((s, r, i) => s + r[a] * y[i], 0));
  for (let c = 0; c < k; c++) { const piv = A[c][c]; for (let j = c; j < k; j++) A[c][j] /= piv; B[c] /= piv; for (let r = 0; r < k; r++) if (r !== c) { const m = A[r][c]; for (let j = c; j < k; j++) A[r][j] -= m * A[c][j]; B[r] -= m * B[c]; } }
  void n;
  return B;
}
console.log("\n=== B) TOPIX ETF(1306) の夜間（引け→翌朝の寄り）: そのまま／同じ夜の米国の動きで説明した残り");
for (let w = 1; w <= 5; w++) row(`${DOW[w]}曜の引けから そのまま`, nights.filter((n) => dowOf(n.pd) === w).map((n) => [n.d, n.on]));
for (const [label, xs] of [["米国の寄り→引けで説明した残り", (n: Night) => [n.usIntra]], ["米国の寄り→引けと寄りの窓で説明した残り", (n: Night) => [n.usIntra, n.usGap]]] as const) {
  const use = nights.filter((n) => n.fresh);
  const beta = ols(use.map((n) => n.on), [0, 1].slice(0, xs(use[0]).length).map((j) => use.map((n) => xs(n)[j])));
  console.log(`  係数（${label}）: 切片 ${f(beta[0] * 1e4)}bp、米国が1%動くと日本の夜間は ${beta.slice(1).map((b) => `${f(b, 5, 2)}%`).join("、")}`);
  for (let w = 1; w <= 5; w++) row(`${DOW[w]}曜の引けから ${label.slice(0, 12)}…の残り`, use.filter((n) => dowOf(n.pd) === w).map((n) => [n.d, n.on - xs(n).reduce((a, x, j) => a + beta[j + 1] * x, 0)]));
}
const mon = nights.filter((n) => dowOf(n.pd) === 1 && n.calGap === 1);
row("月曜の夜 & 米国の月曜が上げ", mon.filter((n) => n.usIntra > 0).map((n) => [n.d, n.on]));
row("月曜の夜 & 米国の月曜が下げ", mon.filter((n) => n.usIntra <= 0).map((n) => [n.d, n.on]));
row("（その夜の）米国の月曜 寄り→引け", mon.map((n) => [n.d, n.usIntra]));
row("米国が休みの月曜の夜（日本だけ開いた）", nights.filter((n) => dowOf(n.pd) === 1 && n.calGap === 1 && !n.fresh).map((n) => [n.d, n.on]));

console.log("\n=== C) 祝日がからむ週");
row("月曜が祝日の週の、火曜の引けから", nights.filter((n) => dowOf(n.pd) === 2 && n.prevCalGap >= 4 && n.calGap === 1).map((n) => [n.d, n.on]));
row("ふつうの火曜の引けから", nights.filter((n) => dowOf(n.pd) === 2 && n.prevCalGap === 1 && n.calGap === 1).map((n) => [n.d, n.on]));
row("月曜の引けから（火曜が祝日で水曜に売る）", nights.filter((n) => dowOf(n.pd) === 1 && n.calGap >= 2).map((n) => [n.d, n.on]));
row("金曜が祝日だった週明けの月曜の引けから", nights.filter((n) => dowOf(n.pd) === 1 && n.prevCalGap >= 4 && n.calGap === 1).map((n) => [n.d, n.on]));

console.log("\n=== E) 火曜の場中で戻すか（1306）");
row("月曜の引け→火曜の寄り", mon.map((n) => [n.d, n.on]));
row("火曜の寄り→引け", mon.map((n) => [n.d, n.intra]));
row("月曜の引け→火曜の引け", mon.map((n) => [n.d, (1 + n.on) * (1 + n.intra) - 1]));
row("火曜の寄り→引け（月曜の夜が+0.5%以上）", mon.filter((n) => n.on >= 0.005).map((n) => [n.d, n.intra]));
row("火曜の寄り→引け（月曜の夜がマイナス）", mon.filter((n) => n.on < 0).map((n) => [n.d, n.intra]));
for (let w = 2; w <= 5; w++) row(`${DOW[w]}曜の引け→翌日の引け（比較用）`, nights.filter((n) => dowOf(n.pd) === w).map((n) => [n.d, (1 + n.on) * (1 + n.intra) - 1]));

// ---- D) 先物の1時間足
async function hourly(symbol: string): Promise<[number, number][]> {
  const file = `${CACHE}/h1-${symbol.replace(/[\^=]/g, "")}.json`;
  if (!existsSync(file)) {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=60m&range=730d&includePrePost=true`, { headers: { "User-Agent": "Mozilla/5.0" } });
    writeFileSync(file, await res.text());
  }
  const r = JSON.parse(readFileSync(file, "utf8")).chart.result[0];
  const o = r.indicators.quote[0].open as (number | null)[];
  return (r.timestamp as number[]).map((t, i) => [t, o[i]] as [number, number | null]).filter((x): x is [number, number] => x[1] != null);
}
const jst = (d: string, hour: number, plusDays = 0) => Date.parse(`${d}T00:00:00Z`) / 1000 - 9 * 3600 + plusDays * 86400 + hour * 3600;
for (const sym of ["NIY=F", "ES=F"]) {
  const bars = await hourly(sym);
  const ts = bars.map((b) => b[0]);
  /** 時刻 t 以降で最初の足の始値。2時間以上あとの足しかなければ null（休場） */
  const at = (t: number): number | null => { let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m + 1; else hi = m; } return lo < ts.length && ts[lo] - t <= 2 * 3600 ? bars[lo][1] : null; };
  console.log(`\n=== D) ${sym === "NIY=F" ? "日経平均先物（CME・円建て）" : "S&P500 先物"} の1時間足: 日本の引け後のどの時間帯に動くか（${new Date(ts[0] * 1000).toISOString().slice(0, 10)} 以降）`);
  console.log("   区間（日本時間）: 夕方 16時→22時 ／ 米国の取引時間 22時→翌6時 ／ 朝 6時→9時 ／ 合計 16時→翌朝9時。翌営業日が翌日でない夜（金曜など）は除く");
  for (let w = 1; w <= 4; w++) {
    const seg: number[][] = [[], [], [], []];
    for (const n of nights) {
      if (dowOf(n.pd) !== w || n.calGap !== 1) continue;
      const p = [at(jst(n.pd, 16)), at(jst(n.pd, 22)), at(jst(n.pd, 6, 1)), at(jst(n.pd, 9, 1))];
      if (p.some((x) => x == null)) continue;
      const q = p as number[];
      seg[0].push(q[1] / q[0] - 1); seg[1].push(q[2] / q[1] - 1); seg[2].push(q[3] / q[2] - 1); seg[3].push(q[3] / q[0] - 1);
    }
    console.log(`${DOW[w]}曜の夜  夕方 ${cell(seg[0])}  米国時間 ${cell(seg[1])}  朝 ${cell(seg[2])}  合計 ${cell(seg[3])}`);
  }
}
// 同じ期間の 1306 の夜間（先物の期間と比べるため）
const since = "2024-07-01";
console.log(`\n1306 の夜間（${since} 以降）: ` + [1, 2, 3, 4, 5].map((w) => `${DOW[w]} ${cell(nights.filter((n) => n.d >= since && dowOf(n.pd) === w).map((n) => n.on))}`).join("  "));
void spIdx;
