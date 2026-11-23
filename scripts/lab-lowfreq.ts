/**
 * 毎日は売買しない方法。注文を前もって出せる（寄り前の気配が要らない）ものを中心に、1回あたりのもうけと回数を見る。
 *   npx tsx scripts/lab-fetch.ts && npx tsx scripts/lab-fetch-topix.ts && npx tsx scripts/lab-lowfreq.ts
 * A) 月曜の持ち越し（引けで買い翌朝売る）  B) 米国が大きく動いた翌日のETF（寄りで買い引けで売る）
 * C) ETF の押し目を数日持つ  D) 上げている銘柄を10日持つ  E) 安寄り買いを「条件の良い日だけ」にした場合（これは寄り前の気配が要る）
 */
import { readFileSync } from "node:fs";
import type { DailyBar } from "../src/core/gapstudy";
import { tickSize, usMarketClosed } from "../src/core/market";
import { CACHE, ETFS, build, f, stat } from "./lab";
import type { Rec } from "./lab";

const PER: [string, string][] = [["2017", "2020"], ["2020", "2023"], ["2023", "2099"]];
const bars = (s: string) => JSON.parse(readFileSync(`${CACHE}/${s}-1d-10y.json`, "utf8")) as DailyBar[];
const good = (b: DailyBar) => b.o > 0 && b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c);
const yen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("ja-JP")}`;
function line(name: string, rows: [string, number][], size: number, extra = "") {
  const a = stat(rows.map((x) => x[1])), sorted = rows.map((x) => x[1]).sort((x, y) => x - y);
  const years = new Map<string, number>();
  for (const [d, r] of rows) years.set(d.slice(0, 4), (years.get(d.slice(0, 4)) ?? 0) + r);
  const span = rows.length ? (Date.parse(rows[rows.length - 1][0]) - Date.parse(rows[0][0])) / 864e5 / 365.25 : 1;
  const neg = [...years].filter(([, v]) => v < 0).length;
  console.log(`  ${name.padEnd(38)} ${String(a.n).padStart(4)}回（年${f(a.n / Math.max(span, 0.1), 5, 1)}回） 1回平均${f(a.m / 100, 6, 2)}% t${f(a.t, 5, 2)} 勝率${f((rows.filter((x) => x[1] > 0).length / Math.max(a.n, 1)) * 100, 4, 0)}% 最悪${f((sorted[0] ?? 0) * 100, 6, 2)}% 期間[${PER.map(([lo, hi]) => f(stat(rows.filter(([d]) => d >= lo && d < hi).map((x) => x[1])).m / 100, 6, 2)).join("")}]% マイナスの年 ${neg}/${years.size}  ${size / 10000}万円で年 ${yen((rows.reduce((q, x) => q + x[1], 0) * size) / Math.max(span, 0.1))}円${extra}`);
}
const sp = bars("_GSPC");
const usBefore = (d: string) => { let lo = 0, hi = sp.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sp[m].date < d) lo = m + 1; else hi = m; } return lo >= 2 ? sp[lo - 1].c / sp[lo - 2].c - 1 : NaN; };

console.log("表の見方: 回数、1回平均、t値、勝率、最悪の1回、期間ごとの1回平均（2017–19 / 2020–22 / 2023–）、マイナスだった年の数、決めた金額を入れたときの年あたりの利益（手数料・税金なし）");
console.log("\n=== A) 月曜の引けで買い、翌営業日の寄りで売る（米国が休みの月曜は除く）。注文は引成と寄成で、前もって出せる");
for (const [s, name] of [["1306.T", "TOPIX連動ETF"], ["1570.T", "日経レバレッジETF"]] as const) {
  const b = bars(s), rows: [string, number][] = [];
  for (let i = 1; i < b.length; i++) { const p = b[i - 1]; if (new Date(`${p.date}T00:00:00Z`).getUTCDay() !== 1 || usMarketClosed(p.date) || !(b[i].o > 0)) continue; const r = (b[i].o + (b[i].dividend ?? 0)) / p.c - 1; if (Math.abs(r) < 0.2) rows.push([b[i].date, r]); }
  line(name, rows, 1000000);
}
console.log("\n=== B) 米国（S&P500）が大きく動いた翌日、逆向きのETFを寄りで買い引けで売る。米国の終値は朝には分かるので、注文は寄り前に出せる");
for (const [name, s, cond] of [["米国+1.5%以上 → 日経ダブルインバース", "1357.T", (u: number) => u >= 0.015], ["米国+1%以上 → 日経ダブルインバース", "1357.T", (u: number) => u >= 0.01], ["米国-2%以下 → 日経レバレッジ", "1570.T", (u: number) => u <= -0.02], ["米国-1.5%以下 → 日経レバレッジ", "1570.T", (u: number) => u <= -0.015], ["米国-2%以下 → TOPIX連動", "1306.T", (u: number) => u <= -0.02]] as const) {
  const b = bars(s), rows: [string, number][] = [];
  for (const x of b) { if (!good(x)) continue; const u = usBefore(x.date); if (cond(u) && Math.abs(x.c / x.o - 1) < 0.25) rows.push([x.date, x.c / x.o - 1]); }
  line(name, rows, 1000000);
}
console.log("\n=== C) ETF の押し目: 5日間で x% 以上下げた日の引けで買い、N 営業日後の引けで売る（持っているあいだは新しく買わない）。「差」は同じ日数をいつ買っても得られた平均との差");
for (const s of ["1306.T", "1321.T"]) {
  const b = bars(s).filter(good);
  for (const [x, n] of [[0.03, 3], [0.03, 5], [0.04, 5], [0.05, 5], [0.04, 10], [0.05, 10], [0.07, 10]] as const) {
    const rows: [string, number][] = [], allN: number[] = [];
    for (let i = 5; i + n < b.length; i++) allN.push(b[i + n].c / b[i].c - 1);
    for (let i = 5; i + n < b.length; i++) { if (b[i].c / b[i - 5].c - 1 > -x) continue; const r = b[i + n].c / b[i].c - 1; if (Math.abs(r) < 0.4) rows.push([b[i].date, r]); i += n - 1; }
    line(`${s.slice(0, 4)} 5日で-${x * 100}%以下 → ${n}日持つ`, rows, 1000000, `  差${f((stat(rows.map((r) => r[1])).m - stat(allN).m) / 100, 6, 2)}%`);
  }
}
// ---- 個別株（TOPIX500 全体）
const DROP = ["6103.T", "6594.T", "7004.T"];
const A = build((s) => !ETFS.includes(s) && !DROP.includes(s)), B = build(() => true, ".cachet");
const byDay = new Map<string, Rec[]>();
for (const u of [A, B]) for (const [d, rs] of u.byDay) byDay.set(d, [...(byDay.get(d) ?? []), ...rs]);
const days = A.days;
const fwd = (r: Rec, n: number): number | null => { let x = 1, cur: Rec | undefined = r; for (let k = 0; k < n; k++) { if (!cur) return null; x *= 1 + cur.c2c; cur = cur.next; } return x - 1; };
console.log("\n=== D) 上げている銘柄を持つ: 20日間の上げが大きい2銘柄を引けで買い、N 営業日後の引けで売る（N 日ごとに入れ替え）。「差」は同じ期間の全銘柄平均との差");
for (const [n, minUp] of [[5, 0.2], [10, 0.2], [10, 0.3], [20, 0.2], [10, 0]] as const) {
  const rows: [string, number][] = [], exc: number[] = [];
  for (let i = 0; i + n < days.length; i += n) {
    // days[i+1] のレコードが「days[i] の引けまでの情報」を持つ
    const c = (byDay.get(days[i + 1]) ?? []).filter((r) => r.r20 >= minUp && r.px * 100 <= 250000).sort((a, b) => b.r20 - a.r20).slice(0, 2);
    const all = (byDay.get(days[i + 1]) ?? []).map((r) => fwd(r, n)).filter((v): v is number => v != null);
    const got = c.map((r) => fwd(r, n)).filter((v): v is number => v != null);
    if (!got.length) continue;
    const m = got.reduce((a, v) => a + v, 0) / got.length;
    rows.push([days[i + 1], m]); exc.push(m - all.reduce((a, v) => a + v, 0) / all.length);
  }
  line(`20日で+${minUp * 100}%以上の上位2銘柄 → ${n}日`, rows, 500000, `  差${f(stat(exc).m / 100, 6, 2)}%（t${f(stat(exc).t, 5, 2)}）`);
}
console.log("\n=== E) 安寄り買い（上位2銘柄×25万円、損切り0.5%）を、条件の良い日だけにした場合。寄り前の気配が要る点は変わらない");
function gapDays(name: string, ok: (c: Rec[], d: string) => boolean) {
  const rows: [string, number][] = [];
  for (const d of days) {
    const c = (byDay.get(d) ?? []).filter((x) => x.gap <= -0.01 && x.px * (1 + x.gap) * 100 <= 250000).sort((a, b) => a.gap - b.gap).slice(0, 2);
    if (c.length < 2 || !ok(c, d)) continue;
    let pnl = 0;
    for (const r of c) { const open = r.px * (1 + r.gap); pnl += Math.floor(250000 / (open * 100)) * 100 * open * (r.lowPct <= -0.005 ? -0.005 - tickSize(open, true) / open : r.intra); }
    rows.push([d, pnl / 500000]);
  }
  line(name, rows, 500000);
}
gapDays("毎日", () => true);
gapDays("2番目の銘柄も3%以上安い日", (c) => c[1].gap <= -0.03);
gapDays("2番目の銘柄も5%以上安い日", (c) => c[1].gap <= -0.05);
gapDays("2番目の銘柄が3%未満の日", (c) => c[1].gap > -0.03);
gapDays("相場全体は安くない日（平均 > -0.3%）", (c) => c[0].mktGap > -0.003);
gapDays("相場全体が1%以上安い日", (c) => c[0].mktGap <= -0.01);
gapDays("VIX 20以上の日", (c) => c[0].vix >= 20);
gapDays("月曜だけ", (c) => c[0].dow === 1);
gapDays("金曜だけ", (c) => c[0].dow === 5);
