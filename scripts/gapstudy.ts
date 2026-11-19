/**
 * ギャップ埋めを日足で長い期間にわたって検証する。
 *   npm run gapstudy                                  # 既定の50銘柄、10年
 *   npm run gapstudy -- --range 5y --gap 2            # 期間とギャップの閾値を変える
 *   npm run gapstudy -- --symbols 7203,6758 --slippage 0
 *   npm run gapstudy -- --cache .cache
 *
 * 分足のバックテストとの違い: 最初の足を待たずに始値で買う。高値と安値の順番が分からないので、
 * 利確と損切りの両方に届いた日は損切りとする。15:20 の強制決済ではなく終値で決済する。
 */
import { gapFadeDaily, summarize } from "../src/core/gapstudy";
import type { GapSummary, GapTrade } from "../src/core/gapstudy";
import { normalizeSymbol } from "../src/core/types";
import { DEFAULT_SYMBOLS, loadDaily } from "./universe";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const symbols = (flag("symbols")?.split(",") ?? DEFAULT_SYMBOLS).map((s: string) => normalizeSymbol(s.trim()));
const range = flag("range") ?? "10y";
const minGapPct = Number(flag("gap") ?? 1);
const slippageTicks = Number(flag("slippage") ?? 1);
const cacheDir = flag("cache");

const data = await loadDaily(symbols, range, cacheDir);
if (data.length === 0) process.exit(1);

const run = (gap: number, useStops: boolean, slip = slippageTicks) => data.flatMap(([symbol, bars]) => gapFadeDaily(symbol, bars, { minGapPct: gap, slippageTicks: slip, useStops }));
const bp = (n: number | null) => (n == null ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}`);
const pct = (n: number | null) => (n == null ? "-" : `${(n * 100).toFixed(1)}%`);
const cells = (s: GapSummary) => [String(s.trades), String(s.days), pct(s.winRate), s.profitFactor == null ? "-" : s.profitFactor.toFixed(2), bp(s.avgBp), bp(s.avgDayBp), s.tStat == null ? "-" : s.tStat.toFixed(2), pct(s.winDayRate)];
const W = [22, 7, 6, 7, 5, 9, 9, 6, 7];
const row = (c: string[]) => c.map((x, i) => (i === 0 ? x.padEnd(W[i]) : x.padStart(W[i]))).join("  ");
const header = (title: string) => row([title, "取引", "日数", "勝率", "PF", "平均bp", "日平均bp", "t値", "勝ち日"]);
const table = (title: string, rows: [string, GapTrade[]][]) => {
  console.log(`\n${header(title)}`);
  for (const [label, trades] of rows) console.log(row([label, ...cells(summarize(trades))]));
};

const allDates = data.flatMap(([, b]) => b.map((x) => x.date)).sort();
console.log(`ギャップ埋め（日足）  ${data.length}銘柄  ${allDates[0]}〜${allDates[allDates.length - 1]}  ギャップ ${minGapPct}%以上  滑り ${slippageTicks}ティック`);
console.log("平均bp は1取引あたり、日平均bp は同じ日の取引を1つにまとめた平均（1bp = 0.01%）。t値はその日平均から計算");

const base = run(minGapPct, true);
table("条件", [
  ["利確・損切りあり", base],
  ["引けまで持つ", run(minGapPct, false)],
  ["利確・損切りあり 滑り0", run(minGapPct, true, 0)],
  // 比較用: ギャップに関係なく毎日、始値で買って終値で売る
  ["毎日 寄り買い引け売り", data.flatMap(([symbol, bars]) => gapFadeDaily(symbol, bars, { minGapPct: -100, slippageTicks, useStops: false, maxGapPct: 100 }))],
]);

const years = [...new Set(base.map((t) => t.date.slice(0, 4)))].sort();
table("年ごと", years.map((y) => [y, base.filter((t) => t.date.startsWith(y))]));

table("ギャップの大きさ", [
  [`${minGapPct}〜2%`, base.filter((t) => t.gapPct > -2)],
  ["2〜3%", base.filter((t) => t.gapPct <= -2 && t.gapPct > -3)],
  ["3〜5%", base.filter((t) => t.gapPct <= -3 && t.gapPct > -5)],
  ["5%以上", base.filter((t) => t.gapPct <= -5)],
]);

// その日に安く寄った銘柄の数で分ける。多い日は相場全体が下げて始まった日
const perDay = new Map<string, number>();
for (const t of base) perDay.set(t.date, (perDay.get(t.date) ?? 0) + 1);
const wide = Math.max(3, Math.round(data.length * 0.3));
table("同じ日に入った銘柄数", [
  ["1〜2銘柄", base.filter((t) => perDay.get(t.date)! <= 2)],
  [`3〜${wide - 1}銘柄`, base.filter((t) => perDay.get(t.date)! > 2 && perDay.get(t.date)! < wide)],
  [`${wide}銘柄以上`, base.filter((t) => perDay.get(t.date)! >= wide)],
]);

const exits = { target: "利確", stop: "損切り", close: "引け" } as const;
console.log(`\n決済の内訳  ${(Object.keys(exits) as (keyof typeof exits)[]).map((k) => `${exits[k]} ${pct(base.filter((t) => t.exit === k).length / Math.max(base.length, 1))}`).join("  ")}`);
