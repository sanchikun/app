/**
 * コマンドラインからのバックテスト。
 *   npm run backtest -- 7203.T
 *   npm run backtest -- 7203.T --interval 5m --range 60d --strategy vwap --slippage 0
 *   npm run backtest -- 7203.T --synthetic   （合成データ。動作確認用）
 */
import { runBacktest } from "../src/core/backtest";
import { DEFAULT_SETTINGS, normalizeSymbol, parseSettings } from "../src/core/types";
import { getProvider } from "../src/data/provider";
import type { Interval, Range } from "../src/data/provider";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const symbolArg = args[0];
if (!symbolArg || symbolArg.startsWith("--")) {
  console.error("usage: npm run backtest -- <symbol> [--interval 5m] [--range 60d] [--strategy orb|vwap] [--slippage n] [--allow-short] [--synthetic]");
  process.exit(1);
}

const overrides: Record<string, unknown> = {};
if (flag("strategy")) overrides.strategy = flag("strategy");
if (flag("slippage")) overrides.slippageTicks = Number(flag("slippage"));
if (flag("target")) overrides.dailyTargetYen = Number(flag("target"));
if (flag("loss-limit")) overrides.dailyLossLimitYen = Number(flag("loss-limit"));
if (args.includes("--allow-short")) overrides.allowShort = true;
if (args.includes("--fine-tick")) overrides.fineTickSymbols = [args[0]];
if (args.includes("--standard-tick")) overrides.fineTickSymbols = [];

const symbol = normalizeSymbol(symbolArg);
const settings = parseSettings(overrides, DEFAULT_SETTINGS);
const synthetic = args.includes("--synthetic");
const interval = (flag("interval") ?? "5m") as Interval;
const range = (flag("range") ?? "60d") as Range;

const bars = await getProvider(synthetic ? "synthetic" : "yahoo").intraday(symbol, interval, range, Math.floor(Date.now() / 1000));
const result = runBacktest(symbol, bars, settings);
const s = result.summary;
const yen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}円`;

console.log(`${symbol}  ${settings.strategy}  ${interval} × ${range}  ${synthetic ? "【合成データ】" : "Yahoo Finance"}`);
console.log(`日数 ${s.days}  合計 ${yen(s.totalPnl)}  1日平均 ${yen(s.avgPnlPerDay)}`);
console.log(`目標達成 ${s.targetDays}日  損失上限 ${s.lossLimitDays}日  勝ち ${s.winDays}日  負け ${s.loseDays}日  取引なし・±0 ${s.flatDays}日`);
console.log(
  `取引 ${s.trades}回  勝率 ${s.winRate == null ? "-" : `${(s.winRate * 100).toFixed(1)}%`}  PF ${s.profitFactor == null ? "-" : s.profitFactor.toFixed(2)}  最大DD ${yen(-s.maxDrawdown)}  最悪日 ${yen(s.worstDay)}  最良日 ${yen(s.bestDay)}`,
);
if (result.tickMismatch) console.log(`注意: 株価が${result.fineTick ? "細かい" : "通常の"}呼値の刻みに合っていません。fineTickSymbols の設定を確認してください（--fine-tick / --standard-tick）。`);
for (const m of result.monthly) console.log(`  ${m.month}  ${yen(m.pnl).padStart(8)}  ${m.days}日  ${m.trades}回`);
for (const d of result.daily) console.log(`  ${d.date}  ${yen(d.pnl).padStart(8)}  ${d.trades}回  ${d.halted ?? ""}`);
