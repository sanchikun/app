/**
 * 押し目の指値（寄り値の x% 下に買い指値、約定したら引けで売る）を5分足で確かめる。
 * 日足では「その日に約定した銘柄の平均」は良く見えるが、1日1銘柄しか持たないなら実際に取れるのは
 * 「最初に約定した銘柄」なので、約定の順番で成績が変わるかを見る。直近60日分しかない。
 */
import { existsSync, readFileSync } from "node:fs";
import type { DailyBar } from "../src/core/gapstudy";
import { jstDate } from "../src/core/market";
import type { Bar } from "../src/core/types";
import { CACHE, f, mean, stat } from "./lab";
import { universe } from "./universe";

interface Fill { s: string; d: string; t: number; ret: number; lowAfter: number; missing: boolean }
const fills = new Map<number, Fill[]>();
const XS = [0.01, 0.015, 0.02, 0.03];
/**
 * 分足の最初の足（多くの日は 9:05 から）で約定した分と、分足では抜けていないのに日足の安値が抜けている分は、
 * どちらが先か分からない。後者だけを「最初」にすると、その後は指値まで下げなかった銘柄だけを選ぶことになり
 * 成績が良く出すぎるので、まとめて「寄り付き直後」として扱う。
 */
const OPENING = 9 * 3600;
for (const x of XS) fills.set(x, []);
const allDays = new Set<string>();
for (const s of universe("all").map((v) => `${v}.T`)) {
  const f5 = `${CACHE}/${s}-5m-60d.json`, f1 = `${CACHE}/${s}-1d-10y.json`;
  if (!existsSync(f5) || !existsSync(f1)) continue;
  const daily = new Map((JSON.parse(readFileSync(f1, "utf8")) as DailyBar[]).map((b) => [b.date, b]));
  const byDay = new Map<string, Bar[]>();
  for (const b of JSON.parse(readFileSync(f5, "utf8")) as Bar[]) { const d = jstDate(b.t); const a = byDay.get(d); if (a) a.push(b); else byDay.set(d, [b]); }
  for (const [d, bars] of byDay) {
    const day = daily.get(d);
    if (!day || !(day.o > 0) || bars.length < 30) continue;
    allDays.add(d);
    // JST の 0:00 からの秒数にする
    const dayStart = Date.parse(`${d}T00:00:00Z`) / 1000 - 9 * 3600;
    const firstT = bars[0].t - dayStart;
    for (const x of XS) {
      const limit = day.o * (1 - x), through = limit * (1 - 0.0005);
      const i = bars.findIndex((b) => b.l <= through);
      if (i >= 0) fills.get(x)!.push({ s, d, t: i === 0 ? OPENING : Math.max(bars[i].t - dayStart, firstT), ret: day.c / limit - 1, lowAfter: Math.min(...bars.slice(i).map((b) => b.l)) / limit - 1, missing: false });
      // 分足では抜けていないのに日足の安値が抜けている日は、分足に欠けている時間帯（多くは 9:00〜9:05）で約定したとみなす
      else if (day.l <= through) fills.get(x)!.push({ s, d, t: OPENING, ret: day.c / limit - 1, lowAfter: day.l / limit - 1, missing: true });
    }
  }
}
const days = [...allDays].sort();
console.log(`5分足 ${days.length}日 ${days[0]}〜${days[days.length - 1]}`);
const hhmm = (t: number) => `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
const withStop = (fl: Fill, stop?: number) => (stop != null && fl.lowAfter <= -stop ? -stop - 0.0003 : fl.ret);
function line(name: string, perDay: Map<string, number[]>) {
  const dm = [...perDay.values()].map(mean);
  const a = stat(dm);
  const n = [...perDay.values()].reduce((x, v) => x + v.length, 0);
  console.log(`  ${name.padEnd(44)} 日数${String(a.n).padStart(3)}/${days.length} 取引${String(n).padStart(6)} 日平均bp${f(a.m, 7)} t${f(a.t, 6, 2)} 勝ち日${f((dm.filter((v) => v > 0).length / Math.max(dm.length, 1)) * 100, 5, 0)}% 最悪日${f(Math.min(...dm, 0) * 100, 6, 2)}%`);
}
const group = (list: Fill[], stop?: number) => { const m = new Map<string, number[]>(); for (const fl of list) m.set(fl.d, [...(m.get(fl.d) ?? []), withStop(fl, stop)]); return m; };
for (const x of XS) {
  const all = fills.get(x)!;
  console.log(`\n=== 寄り値の ${x * 100}% 下に指値  約定 ${all.length}件（うち分足にない時間帯 ${all.filter((v) => v.missing).length}件）`);
  line("その日に約定した全銘柄の平均（日足の検証と同じ）", group(all));
  for (const stop of [undefined, 0.01, 0.02]) {
    const first = new Map<string, Fill[]>();
    for (const fl of all) { const cur = first.get(fl.d); if (!cur || fl.t < cur[0].t) first.set(fl.d, [fl]); else if (fl.t === cur[0].t) cur.push(fl); }
    line(`最初に約定した銘柄（同じ足は平均）${stop ? ` 損切り${stop * 100}%` : ""}`, group([...first.values()].flat(), stop));
  }
  for (const [lo, hi] of [[0, 9 * 3600 + 1], [9 * 3600 + 1, 9.5 * 3600], [9.5 * 3600, 10.5 * 3600], [10.5 * 3600, 12.6 * 3600], [12.5 * 3600, 14 * 3600], [14 * 3600, 16 * 3600]]) line(lo === 0 ? "約定：寄り付き直後（最初の足まで）" : `約定時刻 ${hhmm(lo)}〜${hhmm(hi)}`, group(all.filter((v) => v.t >= lo && v.t < hi)));
  // その日に約定した銘柄数ごと
  const cnt = new Map<string, number>(); for (const fl of all) cnt.set(fl.d, (cnt.get(fl.d) ?? 0) + 1);
  for (const [lo, hi] of [[1, 5], [6, 20], [21, 60], [61, 999]]) line(`その日の約定が ${lo}〜${hi}銘柄`, group(all.filter((v) => cnt.get(v.d)! >= lo && cnt.get(v.d)! <= hi)));
  // 最初の1銘柄を、寄り付きから30分は見送って選ぶ
  const late = new Map<string, Fill[]>();
  for (const fl of all.filter((v) => v.t >= 9.5 * 3600)) { const cur = late.get(fl.d); if (!cur || fl.t < cur[0].t) late.set(fl.d, [fl]); else if (fl.t === cur[0].t) cur.push(fl); }
  line("9:30 以降で最初に約定した銘柄", group([...late.values()].flat()));
}
