/** 2巡目: 出来高、米国市場・VIX・為替、月曜持ち越しの条件、押し目の指値、数日持つ、暦 */
import { ETFS, build, hold, tester } from "./lab";
import type { Rec } from "./lab";

const stocks = build((s) => !ETFS.includes(s));
const T = tester(stocks);
const topix = build((s) => s === "1306.T");
const E = tester(topix);
const gd = (r: Rec) => r.gap <= -0.01;

console.log("=== 出来高（前日の出来高 ÷ その前20日の平均）");
T("gap<=-1 & pVol>=2", "intra", (r) => gd(r) && r.pVol >= 2);
T("gap<=-1 & pVol 1..2", "intra", (r) => gd(r) && r.pVol >= 1 && r.pVol < 2);
T("gap<=-1 & pVol<0.7", "intra", (r) => gd(r) && r.pVol < 0.7);
T("gap<=-1 & pRet<=-2 & pVol>=2", "intra", (r) => gd(r) && r.pRet <= -0.02 && r.pVol >= 2);
T("gap<=-1 & pRet<=-2 & pVol<1.5", "intra", (r) => gd(r) && r.pRet <= -0.02 && r.pVol < 1.5);
T("pVol>=3 (any)", "intra", (r) => r.pVol >= 3);
T("pVol>=3 & pRet>=3", "intra", (r) => r.pVol >= 3 && r.pRet >= 0.03);
T("pVol>=3 & pRet<=-3", "intra", (r) => r.pVol >= 3 && r.pRet <= -0.03);
T("on: pVol>=2", "on", (r) => r.pVol >= 2);
T("on: pVol>=3 & pRet>=3", "on", (r) => r.pVol >= 3 && r.pRet >= 0.03);
T("on: pVol>=3 & pRet<=-3", "on", (r) => r.pVol >= 3 && r.pRet <= -0.03);
T("on: pVol<0.5", "on", (r) => r.pVol < 0.5);
T("c2c: pVol>=3 & pRet>=3", "c2c", (r) => r.pVol >= 3 && r.pRet >= 0.03);
T("c2c: pVol>=3 & pRet<=-3", "c2c", (r) => r.pVol >= 3 && r.pRet <= -0.03);

console.log("=== 米国市場・VIX・為替（当日の寄り前に分かる）: 個別株の場中");
T("us<=-1.5 all", "intra", (r) => r.us <= -0.015);
T("us -1.5..-0.5 all", "intra", (r) => r.us > -0.015 && r.us <= -0.005);
T("us>=+1.5 all", "intra", (r) => r.us >= 0.015);
T("us<=-1 & gap<=-1", "intra", (r) => r.us <= -0.01 && gd(r));
T("us>=0 & gap<=-1", "intra", (r) => r.us >= 0 && gd(r));
T("us>=+1 & gap<=-1", "intra", (r) => r.us >= 0.01 && gd(r));
T("vix>=25 all", "intra", (r) => r.vix >= 25);
T("vix<15 all", "intra", (r) => r.vix < 15);
T("vix>=25 & gap<=-1", "intra", (r) => r.vix >= 25 && gd(r));
T("vix 15..25 & gap<=-1", "intra", (r) => r.vix >= 15 && r.vix < 25 && gd(r));
T("vix<15 & gap<=-1", "intra", (r) => r.vix < 15 && gd(r));
T("jpy<=-1 (円高) all", "intra", (r) => r.jpy <= -0.01);
T("jpy>=+1 (円安) all", "intra", (r) => r.jpy >= 0.01);
T("sox<=-3 all", "intra", (r) => r.sox <= -0.03);
T("sox>=+3 all", "intra", (r) => r.sox >= 0.03);
T("mktGap 対 米国: 行き過ぎ安 (mktGap - us <= -1)", "intra", (r) => r.mktGap - r.us <= -0.01);
T("mktGap 対 米国: 行き過ぎ高 (mktGap - us >= +1)", "intra", (r) => r.mktGap - r.us >= 0.01);

console.log("=== TOPIX ETF(1306): 場中");
E("all", "intra", () => true);
E("us<=-1.5", "intra", (r) => r.us <= -0.015);
E("us>=+1.5", "intra", (r) => r.us >= 0.015);
E("gap<=-1", "intra", (r) => r.gap <= -0.01);
E("gap<=-2", "intra", (r) => r.gap <= -0.02);
E("gap>=+1", "intra", (r) => r.gap >= 0.01);
E("gap - us <= -1", "intra", (r) => r.gap - r.us <= -0.01);
E("gap - us >= +1", "intra", (r) => r.gap - r.us >= 0.01);
E("vix>=25", "intra", (r) => r.vix >= 25);
E("pRet<=-2", "intra", (r) => r.pRet <= -0.02);
E("lo20", "intra", (r) => r.lo20);

console.log("=== TOPIX ETF(1306): 夜間（買う日の引けまでに分かる条件）");
E("all", "on", () => true);
const mon = (r: Rec) => r.dowP === 1;
E("Mon", "on", mon);
E("Mon & 月曜の場中が上げ", "on", (r) => mon(r) && r.pIntra > 0);
E("Mon & 月曜の場中が下げ", "on", (r) => mon(r) && r.pIntra <= 0);
E("Mon & 月曜の前日比が下げ", "on", (r) => mon(r) && r.pRet <= 0);
E("Mon & 月曜の前日比が上げ", "on", (r) => mon(r) && r.pRet > 0);
E("Mon & 金曜の米国が下げ", "on", (r) => mon(r) && r.usP <= 0);
E("Mon & 金曜の米国が上げ", "on", (r) => mon(r) && r.usP > 0);
E("Mon & vix>=20", "on", (r) => mon(r) && r.vixP >= 20);
E("Mon & vix<20", "on", (r) => mon(r) && r.vixP < 20);
E("Mon & above ma200", "on", (r) => mon(r) && r.ma200 > 0);
E("Mon & below ma200", "on", (r) => mon(r) && r.ma200 <= 0);
E("Mon & 月の前半(1-15日に売る)", "on", (r) => mon(r) && r.dom <= 15);
E("Mon & 月の後半", "on", (r) => mon(r) && r.dom > 15);
E("週の最初の営業日（月曜が休みの週の火曜を含む）", "on", (r) => r.dowP === 1 || (r.dowP === 2 && r.calGap === 1 && false));
E("pIntra<=-1 (下げた日の夜)", "on", (r) => r.pIntra <= -0.01);
E("pIntra>=+1 (上げた日の夜)", "on", (r) => r.pIntra >= 0.01);
E("pRet<=-2", "on", (r) => r.pRet <= -0.02);
E("pRet>=+2", "on", (r) => r.pRet >= 0.02);
E("vixP>=25", "on", (r) => r.vixP >= 25);
E("vixP<15", "on", (r) => r.vixP < 15);
E("above ma200", "on", (r) => r.ma200 > 0);
E("below ma200", "on", (r) => r.ma200 <= 0);
E("lo20", "on", (r) => r.lo20);
E("hi20", "on", (r) => r.hi20);
E("連休の前（次の営業日まで4日以上）", "on", (r) => r.calGap >= 4);
E("週末をまたぐ（金曜の引け）", "on", (r) => r.dowP === 5);
E("月末の引け→月初の寄り", "on", (r) => r.monthEndP);
for (const [a, b] of [[1, 5], [6, 10], [11, 15], [16, 20], [21, 25], [26, 31]]) E(`売る日が ${a}〜${b}日`, "on", (r) => r.dom >= a && r.dom <= b);
console.log("=== TOPIX ETF(1306): 引け→翌日の引け");
E("all", "c2c", () => true);
E("Mon close -> Tue close", "c2c", mon);
E("pRet<=-2", "c2c", (r) => r.pRet <= -0.02);
E("lo20", "c2c", (r) => r.lo20);
E("r5<=-4", "c2c", (r) => r.r5 <= -0.04);
E("r5<=-4 & above ma200", "c2c", (r) => r.r5 <= -0.04 && r.ma200 > 0);
for (const n of [3, 5, 10]) E(`r5<=-4 → ${n}日持つ`, (r) => { const h = hold(r, n); return h == null ? null : [h, 0]; }, (r) => r.r5 <= -0.04);
for (const n of [3, 5, 10]) E(`毎日 → ${n}日持つ（比較用）`, (r) => { const h = hold(r, n); return h == null ? null : [h, 0]; }, () => true);

console.log("=== 押し目の指値（寄り値の x% 下に指値、約定したら引けで売る。約定は安値が指値を抜けた日）");
const dip = (x: number) => (r: Rec): [number, number] | null => (r.lowPct <= -x - 0.0005 ? [(1 + r.intra) / (1 - x) - 1, r.mktIntra] : null);
for (const x of [0.01, 0.02, 0.03]) {
  T(`毎日 寄り-${x * 100}%に指値`, dip(x), () => true);
  T(`gap<=-1 の日 寄り-${x * 100}%に指値`, dip(x), gd);
  T(`mktGap>=0 の日 寄り-${x * 100}%に指値`, dip(x), (r) => r.mktGap >= 0);
  T(`above ma200 寄り-${x * 100}%に指値`, dip(x), (r) => r.ma200 > 0);
}

console.log("=== 大きく動いた日のあと数日持つ（前日の引けで買う。上乗せは同じ期間の相場平均との差）");
const H = (n: number) => (r: Rec): [number, number] | null => { const a = hold(r, n), b = hold(r, n, "mktC2c"); return a == null || b == null ? null : [a, b]; };
for (const n of [1, 3, 5, 10]) {
  T(`前日+5%以上 & 出来高3倍 → ${n}日`, H(n), (r) => r.pRet >= 0.05 && r.pVol >= 3);
  T(`前日+5%以上 & 高値引け → ${n}日`, H(n), (r) => r.pRet >= 0.05 && r.pLoc >= 0.8);
  T(`前日-5%以下 & 出来高3倍 → ${n}日`, H(n), (r) => r.pRet <= -0.05 && r.pVol >= 3);
  T(`前日-5%以下 → ${n}日`, H(n), (r) => r.pRet <= -0.05);
  T(`20日高値更新 → ${n}日`, H(n), (r) => r.hi20);
  T(`r5<=-10% → ${n}日`, H(n), (r) => r.r5 <= -0.1);
  T(`r20>=+20% → ${n}日`, H(n), (r) => r.r20 >= 0.2);
  T(`r20<=-15% → ${n}日`, H(n), (r) => r.r20 <= -0.15);
}
