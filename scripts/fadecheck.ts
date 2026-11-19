/**
 * 「前日安値に指値で買い、大引けで売る」を5分足（直近60日）で確かめる。
 *   npm run fadecheck
 *   npm run fadecheck -- --symbols 7203,6758 --cache .cache
 *
 * 60日では優位性の有無までは判断できない。見るのは、日足で数えた約定が分足でも確認できるか、
 * その日の何番目の約定か（発注の時点で分かる）で成績が変わるか、損切りを入れるとどうなるか。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fadeFill, fadeReturn } from "../src/core/fadecheck";
import type { FadeFill } from "../src/core/fadecheck";
import { summarize } from "../src/core/gapstudy";
import { groupByDate, jstMinutes, tickMismatchRate, tickSize } from "../src/core/market";
import { normalizeSymbol } from "../src/core/types";
import type { Bar } from "../src/core/types";
import { yahoo } from "../src/data/provider";
import { DEFAULT_SYMBOLS, loadDaily } from "./universe";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const symbols = (flag("symbols")?.split(",") ?? DEFAULT_SYMBOLS).map((s: string) => normalizeSymbol(s.trim()));
const cacheDir = flag("cache");

async function loadIntraday(symbol: string): Promise<Bar[]> {
  const file = cacheDir ? `${cacheDir}/${symbol}-5m-60d.json` : null;
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Bar[];
  const bars = await yahoo.intraday(symbol, "5m", "60d", Math.floor(Date.now() / 1000));
  if (file) {
    mkdirSync(cacheDir!, { recursive: true });
    writeFileSync(file, JSON.stringify(bars));
  }
  await new Promise((r) => setTimeout(r, 300));
  return bars;
}

interface Row {
  symbol: string;
  date: string;
  fill: FadeFill;
  tick: number;
  close: number;
  ret: number;
  /** その日の何番目の約定か（時刻順、1始まり）。時刻の分からない約定は最後に数える */
  order: number;
}

const daily = await loadDaily(symbols, "1y", cacheDir);
const rows: Row[] = [];
let symbolDays = 0;
let confirmed = 0;
let inMissingBar = 0;
let atOpen = 0;
let onlyIntraday = 0;

for (const [symbol, dbars] of daily) {
  let bars: Bar[];
  try {
    bars = await loadIntraday(symbol);
  } catch (e) {
    console.log(`取得失敗 ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  const index = new Map(dbars.map((b, i) => [b.date, i]));
  for (const [date, day] of groupByDate(bars)) {
    const i = index.get(date);
    // 呼値に乗らない日（株式分割より前の調整済みの値）は指値の刻みが実際と違うので除く
    if (i == null || i < 1 || tickMismatchRate(day, true) > 0.2) continue;
    const d = dbars[i];
    const limit = dbars[i - 1].l - (d.dividend ?? 0);
    const tick = tickSize(limit, true);
    symbolDays++;
    const fill = fadeFill({ limit, tick, open: d.o, low: d.l, bars: day });
    // 日足の安値は抜けていないのに分足だけ抜けている日は、どちらかの値が誤っている
    if (fill?.kind === "intraday" && d.l > limit - tick + 1e-6) onlyIntraday++;
    if (!fill) continue;
    if (fill.kind === "open") atOpen++;
    else if (fill.kind === "intraday") confirmed++;
    else inMissingBar++;
    rows.push({ symbol, date, fill, tick, close: d.c, ret: fadeReturn(fill, d.c, tick), order: 0 });
  }
}

const byDate = new Map<string, Row[]>();
for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
for (const list of byDate.values()) {
  list.sort((a, b) => (a.fill.t ?? Infinity) - (b.fill.t ?? Infinity));
  list.forEach((r, i) => (r.order = i + 1));
}

const bp = (n: number | null) => (n == null ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}`);
const pct = (n: number | null) => (n == null ? "-" : `${(n * 100).toFixed(1)}%`);
const width = (s: string) => [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
const pad = (s: string, w: number, left = false) => (left ? s + " ".repeat(Math.max(0, w - width(s))) : " ".repeat(Math.max(0, w - width(s))) + s);
const W = [30, 6, 5, 7, 5, 8, 9, 6];
const row = (c: string[]) => c.map((x, i) => pad(x, W[i], i === 0)).join(" ");
const table = (title: string, groups: [string, { date: string; ret: number }[]][]) => {
  console.log(`\n${row([title, "取引", "日数", "勝率", "PF", "平均bp", "日平均bp", "t値"])}`);
  for (const [label, t] of groups) {
    const s = summarize(t);
    console.log(row([label, String(s.trades), String(s.days), pct(s.winRate), s.profitFactor == null ? "-" : s.profitFactor.toFixed(2), bp(s.avgBp), bp(s.avgDayBp), s.tStat == null ? "-" : s.tStat.toFixed(2)]));
  }
};

const dates = [...byDate.keys()].sort();
console.log(`前日安値に指値で買い・大引けで売る（5分足）  ${daily.length}銘柄  ${dates[0]}〜${dates[dates.length - 1]}  銘柄×日 ${symbolDays}`);
console.log(`約定 ${rows.length}件  寄り付きで約定 ${atOpen}  5分足で確認できた場中の約定 ${confirmed}  分足に欠けた時間帯での約定 ${inMissingBar}`);
if (onlyIntraday) console.log(`注意: 5分足では指値を抜けたのに日足の安値は抜けていない日が ${onlyIntraday} 件あります（どちらかの値が誤り）。`);

table("約定のしかた", [
  ["すべて", rows],
  ["寄り付きで約定", rows.filter((r) => r.fill.kind === "open")],
  ["場中に約定（5分足で確認）", rows.filter((r) => r.fill.kind === "intraday")],
  ["欠けた時間帯で約定", rows.filter((r) => r.fill.kind === "missing-bar")],
]);

table("その日の何番目の約定か", [
  ["1番目", rows.filter((r) => r.order === 1)],
  ["2〜3番目", rows.filter((r) => r.order >= 2 && r.order <= 3)],
  ["4〜10番目", rows.filter((r) => r.order >= 4 && r.order <= 10)],
  ["11番目以降", rows.filter((r) => r.order >= 11)],
]);

const mins = (r: Row) => (r.fill.t == null ? null : jstMinutes(r.fill.t));
const timed = rows.filter((r) => r.fill.kind === "intraday");
table("場中に約定した時刻", [
  ["9:00〜9:30", timed.filter((r) => mins(r)! < 570)],
  ["9:30〜11:30", timed.filter((r) => mins(r)! >= 570 && mins(r)! < 690)],
  ["12:30〜14:00", timed.filter((r) => mins(r)! >= 750 && mins(r)! < 840)],
  ["14:00〜", timed.filter((r) => mins(r)! >= 840)],
]);

const withStop = (p?: number) => rows.map((r) => ({ date: r.date, ret: fadeReturn(r.fill, r.close, r.tick, p) }));
table("損切り", [
  ["なし", withStop()],
  ["0.5%", withStop(0.5)],
  ["1%", withStop(1)],
  ["2%", withStop(2)],
]);

const drop = rows.map((r) => (r.fill.lowAfter - r.fill.entry) / r.fill.entry).sort((a, b) => a - b);
const q = (p: number) => `${(drop[Math.min(drop.length - 1, Math.floor(drop.length * p))] * 100).toFixed(2)}%`;
console.log(`\n約定後の最大の下げ  中央 ${q(0.5)}  下位25% ${q(0.25)}  下位5% ${q(0.05)}  最悪 ${q(0)}`);
