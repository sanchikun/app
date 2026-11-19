/** 3巡目: 米国が大きく上げた翌日のインバースETF、VIX と安寄り買いの組み合わせ、1日1銘柄の試算 */
import { build, f, mean, stat, tester, PERIODS } from "./lab";
import type { Rec } from "./lab";
import { ETFS } from "./lab";

for (const s of ["1357.T", "1306.T", "1570.T"]) {
  const E = tester(build((x) => x === s));
  console.log(`=== ${s} 場中（寄りで買い引けで売る）`);
  E("all", "intra", () => true);
  for (const x of [0.01, 0.015, 0.02]) E(`us>=+${x * 100}%`, "intra", (r) => r.us >= x);
  for (const x of [0.01, 0.015, 0.02]) E(`us<=-${x * 100}%`, "intra", (r) => r.us <= -x);
  E("sox>=+3%", "intra", (r) => r.sox >= 0.03);
  E("sox<=-3%", "intra", (r) => r.sox <= -0.03);
  E("us>=+1.5% & gap方向が米国と同じ", "intra", (r) => r.us >= 0.015 && (s === "1357.T" ? r.gap < 0 : r.gap > 0));
}
const u = build((s) => !ETFS.includes(s));
const T = tester(u);
console.log("=== 安寄り買い × VIX × 前日下落");
const gd = (r: Rec) => r.gap <= -0.01;
for (const [lo, hi] of [[0, 13], [13, 15], [15, 17], [17, 20], [20, 25], [25, 99]]) T(`gap<=-1 & vix ${lo}..${hi}`, "intra", (r) => gd(r) && r.vix >= lo && r.vix < hi);
for (const [lo, hi] of [[0, 15], [15, 20], [20, 99]]) T(`gap<=-1 & pRet<=-2 & vix ${lo}..${hi}`, "intra", (r) => gd(r) && r.pRet <= -0.02 && r.vix >= lo && r.vix < hi);
for (const y of ["2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"]) T(`${y} gap<=-1 & vix>=15`, "intra", (r) => r.d.startsWith(y) && gd(r) && r.vix >= 15);

console.log("=== 1日1銘柄（最大ギャップ、損切り0.5%、50万円）");
function pick(name: string, cand: (r: Rec) => boolean, stop = 0.005, notional = 500000) {
  const dayRet: [string, number][] = [];
  for (const d of u.days) {
    const c = u.byDay.get(d)!.filter(cand);
    if (!c.length) continue;
    const r = c.reduce((a, b) => (b.gap < a.gap ? b : a));
    dayRet.push([d, r.lowPct <= -stop ? -stop - 0.0003 : r.intra]);
  }
  const a = stat(dayRet.map((x) => x[1]));
  const per = PERIODS.map(([lo, hi]) => { const p = stat(dayRet.filter(([d]) => d >= lo && d < hi).map((x) => x[1])); return `${f(p.m)}/${f(p.t, 5, 2)}`; }).join(" |");
  const m = new Map<string, number>();
  for (const d of u.days) m.set(d.slice(0, 7), 0);
  for (const [d, v] of dayRet) m.set(d.slice(0, 7), m.get(d.slice(0, 7))! + v * notional);
  const mv = [...m.values()].sort((x, y) => x - y);
  console.log(`${name.padEnd(40)} d${String(a.n).padStart(5)} bp${f(a.m)} t${f(a.t, 6, 2)} |${per} | 月平均${f(mean(mv), 7, 0)} +月${f((mv.filter((v) => v > 0).length / mv.length) * 100, 4, 0)}% 下位5%${f(mv[Math.floor(mv.length * 0.05)], 8, 0)} 最悪${f(mv[0], 8, 0)}`);
}
pick("gap<=-1", gd);
pick("gap<=-1 & vix>=15", (r) => gd(r) && r.vix >= 15);
pick("gap<=-1 & vix<15", (r) => gd(r) && r.vix < 15);
pick("gap<=-1 & pRet<=-2", (r) => gd(r) && r.pRet <= -0.02);
pick("gap<=-1 & pRet<=-2 & vix>=15", (r) => gd(r) && r.pRet <= -0.02 && r.vix >= 15);
pick("gap<=-1 & pRet<=-2 & vix<15", (r) => gd(r) && r.pRet <= -0.02 && r.vix < 15);
pick("gap<=-1 & pRet<=-2 & pVol<2", (r) => gd(r) && r.pRet <= -0.02 && r.pVol < 2);
pick("gap<=-1 & us>=0", (r) => gd(r) && r.us >= 0);
pick("gap<=-1 & pRet<=-2 & us>=0", (r) => gd(r) && r.pRet <= -0.02 && r.us >= 0);
