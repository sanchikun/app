/** 前場（寄り→11:30）と後場（12:30→引け）の関係を5分足で見る。直近60日分しかないので、当たりを付けるだけ */
import { existsSync, readFileSync } from "node:fs";
import type { DailyBar } from "../src/core/gapstudy";
import { jstDate } from "../src/core/market";
import type { Bar } from "../src/core/types";
import { CACHE, f, mean, stat } from "./lab";
import { universe } from "./universe";

interface Row { s: string; d: string; gap: number; am: number; lunch: number; pm: number; first30: number; rest: number; last30: number }
const rows: Row[] = [];
for (const s of universe("all").map((v) => `${v}.T`)) {
  const f5 = `${CACHE}/${s}-5m-60d.json`, f1 = `${CACHE}/${s}-1d-10y.json`;
  if (!existsSync(f5) || !existsSync(f1)) continue;
  const dl = JSON.parse(readFileSync(f1, "utf8")) as DailyBar[];
  const idx = new Map(dl.map((b, i) => [b.date, i]));
  const byDay = new Map<string, Bar[]>();
  for (const b of JSON.parse(readFileSync(f5, "utf8")) as Bar[]) { const d = jstDate(b.t); const a = byDay.get(d); if (a) a.push(b); else byDay.set(d, [b]); }
  for (const [d, bars] of byDay) {
    const i = idx.get(d);
    if (i == null || i < 1 || bars.length < 50) continue;
    const day = dl[i], start = Date.parse(`${d}T00:00:00Z`) / 1000 - 9 * 3600;
    const at = (hm: number) => bars.filter((b) => b.t - start < hm * 3600);
    const am = at(11.5), pm = bars.filter((b) => b.t - start >= 12.5 * 3600), e30 = at(9.5), b1500 = at(15);
    if (!am.length || !pm.length || !e30.length || !b1500.length) continue;
    const amClose = am[am.length - 1].c, pmOpen = pm[0].o, p930 = e30[e30.length - 1].c, p1500 = b1500[b1500.length - 1].c;
    rows.push({ s, d, gap: day.o / (dl[i - 1].c - (day.dividend ?? 0)) - 1, am: amClose / day.o - 1, lunch: pmOpen / amClose - 1, pm: day.c / pmOpen - 1, first30: p930 / day.o - 1, rest: day.c / p930 - 1, last30: day.c / p1500 - 1 });
  }
}
const byDay = new Map<string, Row[]>();
for (const r of rows) byDay.set(r.d, [...(byDay.get(r.d) ?? []), r]);
console.log(`${rows.length}件 ${byDay.size}日`);
/** 条件に合う銘柄の日平均と、同じ日の全銘柄平均との差 */
function T(name: string, out: keyof Row, pick: (r: Row, mkt: Row) => boolean) {
  const raw: number[] = [], exc: number[] = [];
  let n = 0;
  for (const rs of byDay.values()) {
    const mkt = Object.fromEntries((["gap", "am", "lunch", "pm", "first30", "rest", "last30"] as const).map((k) => [k, mean(rs.map((r) => r[k]))])) as unknown as Row;
    const sel = rs.filter((r) => pick(r, mkt));
    if (!sel.length) continue;
    n += sel.length;
    const v = mean(sel.map((r) => r[out] as number));
    raw.push(v); exc.push(v - (mkt[out] as number));
  }
  const a = stat(raw), e = stat(exc);
  console.log(`${name.padEnd(46)} →${String(out).padEnd(6)} 取引${String(n).padStart(6)} 日${String(a.n).padStart(3)} 日平均bp${f(a.m, 7)} t${f(a.t, 6, 2)} 上乗せbp${f(e.m, 7)} t${f(e.t, 6, 2)}`);
}
T("毎日（比較用）", "pm", () => true);
T("前場 +2%以上", "pm", (r) => r.am >= 0.02);
T("前場 -2%以下", "pm", (r) => r.am <= -0.02);
T("前場 相場より+2%以上", "pm", (r, m) => r.am - m.am >= 0.02);
T("前場 相場より-2%以下", "pm", (r, m) => r.am - m.am <= -0.02);
T("相場全体の前場 +0.5%以上", "pm", (_, m) => m.am >= 0.005);
T("相場全体の前場 -0.5%以下", "pm", (_, m) => m.am <= -0.005);
T("昼休みに +0.5%以上（後場が高く始まる）", "pm", (r) => r.lunch >= 0.005);
T("昼休みに -0.5%以下", "pm", (r) => r.lunch <= -0.005);
T("毎日（比較用）", "rest", () => true);
T("最初の30分 +1.5%以上", "rest", (r) => r.first30 >= 0.015);
T("最初の30分 -1.5%以下", "rest", (r) => r.first30 <= -0.015);
T("最初の30分 相場より+1.5%以上", "rest", (r, m) => r.first30 - m.first30 >= 0.015);
T("最初の30分 相場より-1.5%以下", "rest", (r, m) => r.first30 - m.first30 <= -0.015);
T("安寄り1%以上 & 最初の30分が上げ", "rest", (r) => r.gap <= -0.01 && r.first30 > 0);
T("安寄り1%以上 & 最初の30分が下げ", "rest", (r) => r.gap <= -0.01 && r.first30 <= 0);
T("安寄り1%以上 & 最初の30分 +0.5%以上", "rest", (r) => r.gap <= -0.01 && r.first30 >= 0.005);
T("安寄り1%以上（寄りから引けまで）", "am", (r) => r.gap <= -0.01);
T("安寄り1%以上（後場だけ）", "pm", (r) => r.gap <= -0.01);
T("毎日（比較用）", "last30", () => true);
T("15時まで +3%以上", "last30", (r) => (1 + r.am) * (1 + r.lunch) * (1 + r.pm) / (1 + r.last30) - 1 >= 0.03);
T("15時まで -3%以下", "last30", (r) => (1 + r.am) * (1 + r.lunch) * (1 + r.pm) / (1 + r.last30) - 1 <= -0.03);
