/**
 * 銘柄選びの検証。複数銘柄でバックテストを回し、寄り付きレンジ確定時点で分かる指標と
 * その日の損益の関係を集計する。
 *   npm run screen                                   # 既定の銘柄リスト、5分足 × 60日、ORB
 *   npm run screen -- --symbols 7203,6758,9984       # 銘柄を指定
 *   npm run screen -- --loss-limit 3000 --slippage 0
 *   npm run screen -- --csv out.csv                  # 銘柄×日の明細を書き出す
 *   npm run screen -- --cache .cache                 # 取得した足を保存し、次回はそれを使う
 *   npm run screen -- --entry limit --limit-wait 3   # 新規を指値にする
 *   npm run screen -- --max-stop-fit 1               # 損切りが損失枠で狭められる日を集計から外す
 *
 * 既定の銘柄はすべて TOPIX500 構成銘柄（細かい呼値）として計算する。
 * 通常の呼値の銘柄を混ぜるときは --standard-tick を付ける（全銘柄に適用）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runBacktest } from "../src/core/backtest";
import { groupByDate, tickMismatchRate } from "../src/core/market";
import { FEATURE_KEYS, FEATURE_LABELS, bucketByFeature, dayFeatures, stats, tercileCuts } from "../src/core/screen";
import type { BucketStats, Observation } from "../src/core/screen";
import { DEFAULT_SETTINGS, normalizeSymbol, parseSettings } from "../src/core/types";
import type { Bar } from "../src/core/types";
import { getProvider } from "../src/data/provider";
import type { Interval, Range } from "../src/data/provider";

/** 売買代金の大きい TOPIX500 構成銘柄（手作業のリスト。入れ替えは --symbols で） */
const DEFAULT_SYMBOLS = [
  "7203", "6758", "9984", "8306", "8316", "8411", "6861", "6501", "8035", "6857",
  "9983", "7974", "6098", "4063", "8058", "8031", "8001", "9432", "9433", "9434",
  "7267", "6902", "7011", "7012", "7013", "6146", "6920", "4502", "4568", "6367",
  "6981", "6954", "6273", "7741", "4661", "8766", "6503", "6702", "6701", "5803",
  "7751", "2914", "9101", "9104", "8053", "6723", "4519", "6752", "7201", "5401",
];

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const symbols = (flag("symbols")?.split(",") ?? DEFAULT_SYMBOLS).map((s: string) => normalizeSymbol(s.trim()));
const overrides: Record<string, unknown> = { fineTickSymbols: args.includes("--standard-tick") ? [] : symbols };
if (flag("strategy")) overrides.strategy = flag("strategy");
if (flag("slippage")) overrides.slippageTicks = Number(flag("slippage"));
if (flag("loss-limit")) overrides.dailyLossLimitYen = Number(flag("loss-limit"));
if (flag("orb-rr")) overrides.orbRewardRisk = Number(flag("orb-rr"));
if (flag("mom-min")) overrides.momMinPct = Number(flag("mom-min"));
if (flag("gap-min")) overrides.gapMinPct = Number(flag("gap-min"));
if (flag("no-entry-after")) overrides.noEntryAfter = flag("no-entry-after");
if (flag("max-trades")) overrides.maxTradesPerDay = Number(flag("max-trades"));
if (flag("entry")) overrides.entryOrder = flag("entry");
if (flag("limit-wait")) overrides.limitWaitBars = Number(flag("limit-wait"));
if (args.includes("--allow-short")) overrides.allowShort = true;
const settings = parseSettings(overrides, DEFAULT_SETTINGS);
const synthetic = args.includes("--synthetic");
const interval = (flag("interval") ?? "5m") as Interval;
const range = (flag("range") ?? "60d") as Range;
const cacheDir = flag("cache");
const maxStopFit = flag("max-stop-fit") ? Number(flag("max-stop-fit")) : null;
const now = Math.floor(Date.now() / 1000);
const provider = getProvider(synthetic ? "synthetic" : "yahoo");

async function load(symbol: string): Promise<Bar[]> {
  const file = cacheDir ? `${cacheDir}/${symbol}-${interval}-${range}.json` : null;
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Bar[];
  const bars = await provider.intraday(symbol, interval, range, now);
  if (file) {
    mkdirSync(cacheDir!, { recursive: true });
    writeFileSync(file, JSON.stringify(bars));
  }
  // 連続アクセスで制限されないよう少し待つ
  if (!synthetic) await new Promise((r) => setTimeout(r, 300));
  return bars;
}

const yen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("ja-JP")}円`;
const pct = (n: number | null) => (n == null ? "-" : `${(n * 100).toFixed(1)}%`);
const pf = (n: number | null) => (n == null ? "-" : n.toFixed(2));
const num = (n: number) => (Math.abs(n) >= 1e8 ? `${(n / 1e8).toFixed(1)}億` : Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

let observations: Observation[] = [];
const lastPrice = new Map<string, number>();
const failed: string[] = [];
const offTick: string[] = [];

for (const symbol of symbols) {
  let bars: Bar[];
  try {
    bars = await load(symbol);
  } catch (e) {
    failed.push(`${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  const fine = settings.fineTickSymbols.includes(symbol);
  // 足が極端に少ない日（取得時点で取引が終わっていない当日など）は除く
  const allDays = [...groupByDate(bars)];
  const usual = median(allDays.map(([, d]) => d.length));
  const days = allDays.filter(([, d]) => d.length >= usual * 0.8);
  // 株価が呼値の刻みに乗らない日は除く。株式分割より前の調整済みの値か、呼値の区分が違う銘柄で、
  // どちらも滑りと損切り幅が実際とずれる
  const onTick = days.filter(([, d]) => tickMismatchRate(d, fine) <= 0.2);
  if (onTick.length < days.length) offTick.push(`${symbol} ${days.length - onTick.length}日`);
  const kept = onTick.flatMap(([, d]) => d);
  if (kept.length === 0) {
    failed.push(`${symbol}: 使える足がありません（すべての日が除外されました）`);
    continue;
  }

  const result = runBacktest(symbol, kept, settings);
  const byDate = new Map<string, { pnls: number[]; rets: number[] }>();
  for (const t of result.trades) {
    const d = byDate.get(t.date) ?? { pnls: [], rets: [] };
    d.pnls.push(t.pnl);
    d.rets.push(t.pnl / (t.entryPrice * t.shares));
    byDate.set(t.date, d);
  }
  const mine: Observation[] = dayFeatures(kept, settings, fine).map((f) => ({ symbol, date: f.date, features: f, tradePnls: byDate.get(f.date)?.pnls ?? [], tradeRets: byDate.get(f.date)?.rets ?? [] }));
  observations.push(...mine);
  lastPrice.set(symbol, kept[kept.length - 1].c);
}

const row = (cells: string[], widths: number[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");

console.log(`${settings.strategy}${settings.entryOrder === "limit" ? `（指値・${settings.limitWaitBars}本待ち）` : ""}  ${interval} × ${range}  ${synthetic ? "【合成データ】" : "Yahoo Finance"}  損失上限 ${settings.dailyLossLimitYen}円  滑り ${settings.slippageTicks}ティック  ${settings.shares}株`);
console.log(`銘柄 ${lastPrice.size}/${symbols.length}  銘柄×日 ${observations.length}`);
for (const f of failed) console.log(`対象外 ${f}`);
if (offTick.length) console.log(`注意: 株価が呼値の刻みに合わない日を除きました（${offTick.join("、")}）。株式分割の前か、TOPIX500 構成銘柄でない可能性があります。`);
if (observations.length === 0) process.exit(1);

const line = (b: BucketStats) => `${b.label}  銘柄×日 ${b.days}  取引 ${b.trades}回  合計 ${yen(b.pnl)}  勝率 ${pct(b.winRate)}  PF ${pf(b.profitFactor)}  平均 ${b.avgRetBp == null ? "-" : `${b.avgRetBp >= 0 ? "+" : ""}${b.avgRetBp.toFixed(1)}bp`}/取引`;
console.log(`\n${line(stats("全体", observations))}`);
if (maxStopFit != null) {
  const out = observations.filter((o) => o.features.stopFit > maxStopFit);
  observations = observations.filter((o) => o.features.stopFit <= maxStopFit);
  console.log(line(stats(`損切り幅÷損失枠 > ${maxStopFit}（以下の集計から除外）`, out)));
  console.log(line(stats("残り", observations)));
  if (observations.length === 0) process.exit(1);
}

// 前半で境界を決め、後半でも同じ傾向が出るかを見る
const dates = [...new Set(observations.map((o) => o.date))].sort();
const split = dates[Math.floor(dates.length / 2)];
const first = observations.filter((o) => o.date < split);
const second = observations.filter((o) => o.date >= split);
console.log(line(stats(`前半（${dates[0]}〜）`, first)));
console.log(line(stats(`後半（${split}〜）`, second)));
console.log(`\n■ 指標ごとの成績（境界は前半のデータで3等分して決め、後半にもそのまま当てはめる）`);
console.log(`  前半 ${dates[0]}〜  後半 ${split}〜${dates[dates.length - 1]}`);
const w = [4, 16, 6, 6, 10, 7, 5];
for (const key of FEATURE_KEYS) {
  const cuts = tercileCuts(first.map((o) => o.features[key]).filter((v): v is number => v != null));
  if (!cuts) continue;
  console.log(`\n${FEATURE_LABELS[key]}  境界 ${num(cuts[0])} / ${num(cuts[1])}`);
  console.log(`  ${row(["", "区分", "日数", "取引", "合計", "勝率", "PF"], w)}`);
  for (const [name, part] of [["前半", first], ["後半", second]] as const) {
    for (const b of bucketByFeature(part, key, cuts)) {
      console.log(`  ${row([name, b.label, String(b.days), String(b.trades), yen(b.pnl), pct(b.winRate), pf(b.profitFactor)], w)}`);
    }
  }
}

console.log(`\n■ 銘柄ごと（合計の多い順）。レンジ値幅と売買代金は寄り付きレンジの中央値`);
const ws = [7, 8, 5, 10, 10, 5, 10, 7, 5];
console.log(`  ${row(["銘柄", "株価", "日数", "値幅(tick)", "売買代金", "取引", "合計", "勝率", "PF"], ws)}`);
const perSymbol = [...lastPrice].flatMap(([symbol, price]) => {
  const mine = observations.filter((o) => o.symbol === symbol);
  if (mine.length === 0) return [];
  return [{ symbol, price, days: mine.length, rangeTicks: median(mine.map((o) => o.features.orRangeTicks)), turnover: median(mine.map((o) => o.features.orTurnover)), s: stats(symbol, mine) }];
});
for (const p of perSymbol.sort((a, b) => b.s.pnl - a.s.pnl)) {
  console.log(`  ${row([p.symbol, num(p.price), String(p.days), num(p.rangeTicks), num(p.turnover), String(p.s.trades), yen(p.s.pnl), pct(p.s.winRate), pf(p.s.profitFactor)], ws)}`);
}

const csv = flag("csv");
if (csv) {
  const lines = [["symbol", "date", ...FEATURE_KEYS, "trades", "pnl"].join(",")];
  for (const o of observations) {
    lines.push([o.symbol, o.date, ...FEATURE_KEYS.map((k) => o.features[k] ?? ""), o.tradePnls.length, o.tradePnls.reduce((a, p) => a + p, 0)].join(","));
  }
  writeFileSync(csv, `${lines.join("\n")}\n`);
  console.log(`\n明細を ${csv} に書き出しました（${observations.length}行）`);
}
