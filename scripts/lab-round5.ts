/**
 * 5巡目: 業種ごとの動き、暦（SQ・権利落ち・月末月初・曜日）。
 *   npx tsx scripts/lab-round5.ts
 * 業種は銘柄リストを手で14に分けたもの。業種の値は「自分を除いた同じ業種の平均」で、相場平均との差を見る。
 * 寄りのギャップを使う条件は、寄り付いた時点で分かるもの（安寄り買いと同じ扱い）。
 */
import { ETFS, PERIODS, build, f, mean, stat, tester } from "./lab";
import type { Rec } from "./lab";
import { SECTORS, secOf } from "./lab-sectors";

const u = build((s) => !ETFS.includes(s));
const T = tester(u);
const missing = [...new Set(u.recs.map((r) => r.s))].filter((s) => !secOf.has(s));
if (missing.length) console.log("業種なし:", missing.join(" "));

/** 業種の値（自分を除く同業種の平均 − 相場平均）。sg = 今朝のギャップ、sp = 前日の前日比、spi = 前日の場中、s5 = 5日 */
interface Sec { sg: number; sp: number; spi: number; s5: number; k: number }
const sec = new Map<Rec, Sec>();
for (const rs of u.byDay.values()) {
  const groups = new Map<string, Rec[]>();
  for (const r of rs) { const k = secOf.get(r.s); if (!k) continue; const a = groups.get(k); if (a) a.push(r); else groups.set(k, [r]); }
  const m5 = mean(rs.map((r) => r.r5));
  for (const g of groups.values()) {
    if (g.length < 4) continue;
    const sum = (key: "gap" | "pRet" | "pIntra" | "r5") => g.reduce((a, r) => a + r[key], 0);
    const tg = sum("gap"), tp = sum("pRet"), ti = sum("pIntra"), t5 = sum("r5"), n = g.length - 1;
    for (const r of g) sec.set(r, { sg: (tg - r.gap) / n - r.mktGap, sp: (tp - r.pRet) / n - r.mktPRet, spi: (ti - r.pIntra) / n - r.mktPIntra, s5: (t5 - r.r5) / n - m5, k: n });
  }
}
const S = (r: Rec) => sec.get(r);
const gd = (r: Rec) => r.gap <= -0.01;

/** 1日1銘柄: 条件に合う中でギャップ最大の1銘柄を寄りで買い、0.5%で損切り、引けで売る（lab-forward と同じ数え方） */
function pick(name: string, cand: (r: Rec) => boolean, dayOk: (d: string) => boolean = () => true, stop = 0.005) {
  const dayRet: [string, number][] = [];
  for (const d of u.days) {
    if (!dayOk(d)) continue;
    const c = u.byDay.get(d)!.filter(cand);
    if (!c.length) continue;
    const r = c.reduce((a, b) => (b.gap < a.gap ? b : a));
    dayRet.push([d, r.lowPct <= -stop ? -stop - 0.0003 : r.intra]);
  }
  const a = stat(dayRet.map((x) => x[1]));
  const per = PERIODS.map(([lo, hi]) => { const p = stat(dayRet.filter(([d]) => d >= lo && d < hi).map((x) => x[1])); return `${f(p.m)}/${f(p.t, 5, 2)}(${String(p.n).padStart(3)})`; }).join(" |");
  console.log(`${name.padEnd(44)} d${String(a.n).padStart(5)} bp${f(a.m)} t${f(a.t, 6, 2)} 勝率${f((dayRet.filter((x) => x[1] > 0).length / Math.max(a.n, 1)) * 100, 4, 0)}% |${per}`);
}

console.log("=== 業種: 前日までの業種の強弱（相場平均との差）→ 当日の場中・夜間");
for (const x of [0.01, 0.015, 0.02]) {
  T(`業種が前日 +${x * 100}%以上強い`, "intra", (r) => (S(r)?.sp ?? 0) >= x);
  T(`業種が前日 -${x * 100}%以上弱い`, "intra", (r) => (S(r)?.sp ?? 0) <= -x);
  T(`業種が前日 +${x * 100}%以上強い（夜間）`, "on", (r) => (S(r)?.sp ?? 0) >= x);
  T(`業種が前日 -${x * 100}%以上弱い（夜間）`, "on", (r) => (S(r)?.sp ?? 0) <= -x);
}
for (const x of [0.03, 0.05]) {
  T(`業種が5日で +${x * 100}%以上強い`, "c2c", (r) => (S(r)?.s5 ?? 0) >= x);
  T(`業種が5日で -${x * 100}%以上弱い`, "c2c", (r) => (S(r)?.s5 ?? 0) <= -x);
}
console.log("=== 業種: 業種は上げたのに自分だけ遅れた／先走った（前日）→ 当日の場中・前日引け→当日引け");
for (const x of [0.01, 0.02]) {
  T(`業種 +${x * 100}%強い & 自分は相場以下`, "c2c", (r) => (S(r)?.sp ?? 0) >= x && r.pRet <= r.mktPRet);
  T(`業種 -${x * 100}%弱い & 自分は相場以上`, "c2c", (r) => (S(r)?.sp ?? 0) <= -x && r.pRet >= r.mktPRet);
  T(`業種 +${x * 100}%強い & 自分は相場以下`, "intra", (r) => (S(r)?.sp ?? 0) >= x && r.pRet <= r.mktPRet);
  T(`業種 -${x * 100}%弱い & 自分は相場以上`, "intra", (r) => (S(r)?.sp ?? 0) <= -x && r.pRet >= r.mktPRet);
}
console.log("=== 業種: 安寄りが「業種ぐるみ」か「自分だけ」か → 場中");
T("gap<=-1（比較用）", "intra", gd);
for (const x of [0.003, 0.005, 0.01]) {
  T(`gap<=-1 & 業種も相場より -${x * 100}%以上安寄り`, "intra", (r) => gd(r) && (S(r)?.sg ?? 0) <= -x);
  T(`gap<=-1 & 業種は相場より +${x * 100}%以上高寄り`, "intra", (r) => gd(r) && (S(r)?.sg ?? 0) >= x);
}
T("gap<=-1 & 業種は相場並み(±0.3%)", "intra", (r) => gd(r) && Math.abs(S(r)?.sg ?? 9) < 0.003);
for (const x of [0.01, 0.015, 0.02]) T(`自分だけ安寄り: gap − 業種gap <= -${x * 100}%`, "intra", (r) => { const s = S(r); return !!s && r.gap - (s.sg + r.mktGap) <= -x; });
T("業種が相場より -1%以上安寄り（全銘柄）", "intra", (r) => (S(r)?.sg ?? 0) <= -0.01);
T("業種が相場より +1%以上高寄り（全銘柄）", "intra", (r) => (S(r)?.sg ?? 0) >= 0.01);
console.log("=== 業種: 1日1銘柄で（最大ギャップ、損切り0.5%）");
pick("gap<=-1", gd);
pick("gap<=-1 & pRet<=-2（候補1）", (r) => gd(r) && r.pRet <= -0.02);
for (const x of [0.003, 0.005, 0.01]) {
  pick(`gap<=-1 & 業種も -${x * 100}%以上安寄り`, (r) => gd(r) && (S(r)?.sg ?? 0) <= -x);
  pick(`gap<=-1 & 業種は -${x * 100}%より安寄りでない`, (r) => gd(r) && (S(r)?.sg ?? -9) > -x);
  pick(`候補1 & 業種も -${x * 100}%以上安寄り`, (r) => gd(r) && r.pRet <= -0.02 && (S(r)?.sg ?? 0) <= -x);
  pick(`候補1 & 業種は -${x * 100}%より安寄りでない`, (r) => gd(r) && r.pRet <= -0.02 && (S(r)?.sg ?? -9) > -x);
}
for (const x of [0.01, 0.02]) pick(`候補1 & 業種が前日 -${x * 100}%以上弱い`, (r) => gd(r) && r.pRet <= -0.02 && (S(r)?.sp ?? 0) <= -x);
for (const x of [0.01, 0.02]) pick(`候補1 & 業種は前日弱くない(> -${x * 100}%)`, (r) => gd(r) && r.pRet <= -0.02 && (S(r)?.sp ?? -9) > -x);
console.log("--- 業種別（gap<=-1 の場中、全取引）");
for (const name of Object.keys(SECTORS)) T(`gap<=-1 ${name}`, "intra", (r) => gd(r) && secOf.get(r.s) === name);

// ---- 暦 ----
const dayIdx = new Map(u.days.map((d, i) => [d, i]));
const lastOfMonth = new Set(u.days.filter((d, i) => i + 1 < u.days.length && u.days[i + 1].slice(0, 7) !== d.slice(0, 7)));
const firstOfMonth = new Set(u.days.filter((d, i) => i > 0 && u.days[i - 1].slice(0, 7) !== d.slice(0, 7)));
/** SQ の日: 第2金曜。休場ならその前の営業日 */
const sq = new Set<string>(), majorSq = new Set<string>();
for (let y = 2016; y <= 2027; y++) for (let m = 0; m < 12; m++) {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const day = 1 + ((5 - first + 7) % 7) + 7;
  const iso = new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
  const d = [...u.days].reverse().find((x) => x <= iso);
  if (d && d.slice(0, 7) === iso.slice(0, 7)) { sq.add(d); if (m % 3 === 2) majorSq.add(d); }
}
const off = (set: Set<string>, k: number) => new Set([...set].map((d) => u.days[dayIdx.get(d)! + k]).filter(Boolean));
const sqEve = off(sq, -1), sqNext = off(sq, 1), sqWeek = new Set([...sq].flatMap((d) => [0, -1, -2, -3, -4].map((k) => u.days[dayIdx.get(d)! + k])));
/** 権利落ちが集中する日（その日の銘柄の2割以上に配当落ちがある） */
const exDay = new Set(u.days.filter((d) => { const rs = u.byDay.get(d)!; return rs.filter((r) => r.div > 0).length / rs.length >= 0.2; }));
const exEve = off(exDay, -1), exNext = off(exDay, 1);
console.log(`=== 暦: SQ ${sq.size}日（うち3・6・9・12月 ${majorSq.size}日）、権利落ち集中日 ${exDay.size}日、月末 ${lastOfMonth.size}日`);
const cal: [string, (d: string) => boolean][] = [
  ["SQの日", (d) => sq.has(d)], ["SQの日（3・6・9・12月）", (d) => majorSq.has(d)], ["SQの前日", (d) => sqEve.has(d)], ["SQの翌営業日", (d) => sqNext.has(d)], ["SQの週（5日）", (d) => sqWeek.has(d)],
  ["権利落ち集中日", (d) => exDay.has(d)], ["権利付き最終日", (d) => exEve.has(d)], ["権利落ちの翌日", (d) => exNext.has(d)],
  ["月の最終営業日", (d) => lastOfMonth.has(d)], ["月の最初の営業日", (d) => firstOfMonth.has(d)],
  ["月末の3営業日", (d) => [0, 1, 2].some((k) => lastOfMonth.has(u.days[dayIdx.get(d)! + k]))], ["月初の3営業日", (d) => [0, 1, 2].some((k) => firstOfMonth.has(u.days[dayIdx.get(d)! - k]))],
  ["月曜", (d) => new Date(d).getUTCDay() === 1], ["火曜", (d) => new Date(d).getUTCDay() === 2], ["水曜", (d) => new Date(d).getUTCDay() === 3], ["木曜", (d) => new Date(d).getUTCDay() === 4], ["金曜", (d) => new Date(d).getUTCDay() === 5],
  ["連休明け（前の営業日から4日以上）", (d) => { const i = dayIdx.get(d)!; return i > 0 && (Date.parse(d) - Date.parse(u.days[i - 1])) / 864e5 >= 4; }],
  ["連休前（次の営業日まで4日以上）", (d) => { const i = dayIdx.get(d)!; return i + 1 < u.days.length && (Date.parse(u.days[i + 1]) - Date.parse(d)) / 864e5 >= 4; }],
];
console.log("--- 全銘柄の場中（上乗せは意味がないので日平均を見る）と、その日へ持ち越す夜間");
for (const [name, ok] of cal) { T(`${name} 場中`, "intra", (r) => ok(r.d)); T(`${name} へ持ち越す夜`, "on", (r) => ok(r.d)); }
console.log("--- 個別の権利落ち（配当落ちのある銘柄×日。夜間・前日比は配当込み）");
T("権利落ち日の場中", "intra", (r) => r.div > 0);
T("権利付き最終日の引け→権利落ち日の寄り（配当込み）", "on", (r) => r.div > 0);
T("権利付き最終日の場中", (r) => (r.next && r.next.div > 0 ? [r.intra, r.mktIntra] : null), () => true);
T("権利落ち日 & gap<=-1 の場中", "intra", (r) => r.div > 0 && gd(r));
T("権利落ち日の翌日の場中", (r) => (r.next ? [r.next.intra, r.next.mktIntra] : null), (r) => r.div > 0);
console.log("--- 暦 × 安寄り買い（1日1銘柄、最大ギャップ、損切り0.5%）: 上が条件なし、下が候補1");
for (const [name, ok] of cal) { pick(`${name}`, gd, ok); pick(`${name} 候補1`, (r) => gd(r) && r.pRet <= -0.02, ok); }
console.log("--- 暦 × 安寄り買い: その日を除いたとき");
for (const [name, ok] of cal.slice(0, 12)) pick(`${name} を除く 候補1`, (r) => gd(r) && r.pRet <= -0.02, (d) => !ok(d));
console.log("--- 候補1を年ごとに、木曜とそれ以外");
for (let y = 2017; y <= 2026; y++) { pick(`${y} 木曜`, (r) => gd(r) && r.pRet <= -0.02, (d) => d.startsWith(String(y)) && new Date(d).getUTCDay() === 4); pick(`${y} 木曜以外`, (r) => gd(r) && r.pRet <= -0.02, (d) => d.startsWith(String(y)) && new Date(d).getUTCDay() !== 4); }

// ---- 追加: 「自分だけ安寄り」（ギャップ − 同業種の他銘柄のギャップ）を、相場平均との差と比べ、1日1銘柄でも確かめる ----
const rs = (r: Rec) => { const s = S(r); return s ? r.gap - (s.sg + r.mktGap) : NaN; }; // 業種に対するギャップ
const rm = (r: Rec) => r.gap - r.mktGap; // 相場平均に対するギャップ
console.log("=== 自分だけ安寄り: 全取引の場中（相場に対して／業種に対して）");
for (const x of [0.0075, 0.01, 0.015]) { T(`gap − 相場 <= -${x * 100}%`, "intra", (r) => rm(r) <= -x); T(`gap − 業種 <= -${x * 100}%`, "intra", (r) => rs(r) <= -x); }
T("gap − 相場 <= -1% のうち 業種も相場より -0.5%安い", "intra", (r) => rm(r) <= -0.01 && (S(r)?.sg ?? 0) <= -0.005);
T("gap − 相場 <= -1% のうち 業種は相場並み以上", "intra", (r) => rm(r) <= -0.01 && (S(r)?.sg ?? -9) > -0.002);
T("gap − 業種 <= -1% & gap > -1%（相場が高い日の出遅れ）", "intra", (r) => rs(r) <= -0.01 && r.gap > -0.01);
T("gap − 業種 <= -1% & gap <= -1%", "intra", (r) => rs(r) <= -0.01 && r.gap <= -0.01);
T("gap <= -1% & gap − 業種 > -1%（業種ぐるみ）", "intra", (r) => r.gap <= -0.01 && rs(r) > -0.01);
/** 1日1銘柄: key が最も小さい1銘柄を寄りで買う。stop=0 は損切りなし */
function pickBy(name: string, key: (r: Rec) => number, cand: (r: Rec) => boolean, stop = 0.005) {
  const dayRet: [string, number][] = [];
  for (const d of u.days) {
    const c = u.byDay.get(d)!.filter((r) => Number.isFinite(key(r)) && cand(r));
    if (!c.length) continue;
    const r = c.reduce((a, b) => (key(b) < key(a) ? b : a));
    dayRet.push([d, stop > 0 && r.lowPct <= -stop ? -stop - 0.0003 : r.intra]);
  }
  const a = stat(dayRet.map((x) => x[1]));
  const per = PERIODS.map(([lo, hi]) => { const p = stat(dayRet.filter(([d]) => d >= lo && d < hi).map((x) => x[1])); return `${f(p.m)}/${f(p.t, 5, 2)}(${String(p.n).padStart(3)})`; }).join(" |");
  console.log(`${name.padEnd(48)} d${String(a.n).padStart(5)} bp${f(a.m)} t${f(a.t, 6, 2)} 勝率${f((dayRet.filter((x) => x[1] > 0).length / Math.max(a.n, 1)) * 100, 4, 0)}% |${per}`);
}
console.log("=== 自分だけ安寄り: 1日1銘柄（損切り0.5%／損切りなし）");
for (const stop of [0.005, 0]) {
  const tag = stop ? "損切り0.5%" : "損切りなし";
  pickBy(`${tag} 最大ギャップ gap<=-1（現行）`, (r) => r.gap, gd, stop);
  pickBy(`${tag} 最大ギャップ 候補1`, (r) => r.gap, (r) => gd(r) && r.pRet <= -0.02, stop);
  for (const x of [0.01, 0.015, 0.02]) {
    pickBy(`${tag} 業種比が最大 (<=-${x * 100}%)`, rs, (r) => rs(r) <= -x, stop);
    pickBy(`${tag} 業種比が最大 (<=-${x * 100}%) & gap<=-1`, rs, (r) => rs(r) <= -x && gd(r), stop);
    pickBy(`${tag} 業種比が最大 (<=-${x * 100}%) & 候補1`, rs, (r) => rs(r) <= -x && gd(r) && r.pRet <= -0.02, stop);
    pickBy(`${tag} 相場比が最大 (<=-${x * 100}%)`, rm, (r) => rm(r) <= -x, stop);
  }
  pickBy(`${tag} 最大ギャップ 候補1 & 業種比<=-1%`, (r) => r.gap, (r) => gd(r) && r.pRet <= -0.02 && rs(r) <= -0.01, stop);
  pickBy(`${tag} 最大ギャップ 候補1 & 業種比>-1%`, (r) => r.gap, (r) => gd(r) && r.pRet <= -0.02 && rs(r) > -0.01, stop);
}
