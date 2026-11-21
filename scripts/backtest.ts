/**
 * コマンドラインからのバックテスト。
 *   npm run backtest -- 7203.T
 *   npm run backtest -- 7203.T --interval 5m --range 60d --strategy vwap --slippage 0
 *   npm run backtest -- 7203.T --synthetic   （合成データ。動作確認用）
 */
import { runBacktest } from "../src/core/backtest";
import { DEFAULT_SETTINGS, normalizeSymbol, parseSettings } from "../src/core/types";
import { runGapOpenBacktest } from "../src/core/gapopen";
import { getProvider } from "../src/data/provider";
import type { Interval, Range } from "../src/data/provider";
import { loadDaily, universe } from "./universe";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const symbolArg = args[0];
if (!symbolArg || symbolArg.startsWith("--")) {
  console.error("usage: npm run backtest -- <symbol> [--interval 5m] [--range 60d] [--strategy orb|vwap|momentum|gapfade|pullback|gapopen|overnight|gapopen_overnight] [--slippage n] [--entry market|limit] [--limit-wait n] [--allow-short] [--synthetic]");
  process.exit(1);
}

const overrides: Record<string, unknown> = {};
if (flag("strategy")) overrides.strategy = flag("strategy");
if (flag("slippage")) overrides.slippageTicks = Number(flag("slippage"));
if (flag("target")) overrides.dailyTargetYen = Number(flag("target"));
if (flag("loss-limit")) overrides.dailyLossLimitYen = Number(flag("loss-limit"));
if (flag("orb-rr")) overrides.orbRewardRisk = Number(flag("orb-rr"));
if (flag("mom-min")) overrides.momMinPct = Number(flag("mom-min"));
if (flag("gap-min")) overrides.gapMinPct = Number(flag("gap-min"));
if (flag("entry")) overrides.entryOrder = flag("entry");
if (flag("limit-wait")) overrides.limitWaitBars = Number(flag("limit-wait"));
if (args.includes("--allow-short")) overrides.allowShort = true;
if (args.includes("--fine-tick")) overrides.fineTickSymbols = [args[0]];
if (args.includes("--standard-tick")) overrides.fineTickSymbols = [];

if (flag("gap-stop")) overrides.gapStopPct = Number(flag("gap-stop"));
if (flag("shares")) overrides.shares = Number(flag("shares"));
if (flag("max-position")) overrides.maxPositionYen = Number(flag("max-position"));
if (flag("overnight-min")) overrides.overnightMinPct = Number(flag("overnight-min"));
if (flag("overnight-max-position")) overrides.overnightMaxPositionYen = Number(flag("overnight-max-position"));
if (flag("overnight-shares")) overrides.overnightShares = Number(flag("overnight-shares"));
if (args.includes("--overnight-skip-us-holidays")) overrides.overnightSkipUsHolidays = true;
if (flag("gap-positions")) overrides.gapMaxPositions = Number(flag("gap-positions"));
if (flag("gap-position-yen")) overrides.gapPositionYen = Number(flag("gap-position-yen"));
if (flag("max-trades")) overrides.maxTradesPerDay = Number(flag("max-trades"));
if (flag("gap-exit-at")) overrides.gapExitAt = flag("gap-exit-at");
if (flag("gap-stop-from")) overrides.gapStopFrom = flag("gap-stop-from");
if (flag("gap-prev-drop")) overrides.gapPrevDropPct = Number(flag("gap-prev-drop"));
if (flag("overnight-weekdays")) overrides.overnightWeekdays = flag("overnight-weekdays")!.split(",").map(Number);
if (flag("overnight-symbols")) overrides.overnightSymbols = flag("overnight-symbols")!.split(",");
const yen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}円`;

const DAILY = { gapopen: "安寄り買い", overnight: "上げた日の持ち越し", gapopen_overnight: "安寄り買い＋持ち越し" } as const;
if ((flag("strategy") ?? "") in DAILY) {
  // 安寄り買いは日足で検証する。銘柄はカンマ区切りで複数、または core（既定の50銘柄）・wide（それ以外の約200銘柄）・all（両方）を指定できる
  const list = (["core", "wide", "all"].includes(symbolArg) ? universe(symbolArg) : symbolArg.split(",")).map((x: string) => normalizeSymbol(x.trim()));
  if (!args.includes("--standard-tick")) overrides.fineTickSymbols = list;
  const s = { ...parseSettings(overrides, DEFAULT_SETTINGS), symbols: list };
  const range = flag("range") ?? "10y";
  const data = await loadDaily([...new Set([...list, ...s.overnightSymbols])], range, flag("cache"));
  if (s.gapExitAt || s.gapStopFrom) console.log("注意: gapExitAt（時刻を決めて売る）と gapStopFrom（損切りを遅らせる）は分足が要るので、この日足のバックテストには反映されません（引け売り・寄りから損切りで計算）。");
  const result = runGapOpenBacktest(data, s);
  const m = result.summary;
  const rules = [
    ...(s.strategy !== "overnight" ? [`${s.gapPrevDropPct > 0 ? `前日${s.gapPrevDropPct}%以上下げ、` : ""}${s.gapMinPct}%以上安く寄ったら${s.gapMaxPositions > 1 ? `${s.gapMaxPositions}銘柄まで` : ""}${s.gapPositionYen > 0 ? `1銘柄${s.gapPositionYen}円分を` : ""}寄りで買い、${s.gapStopPct}%で損切り、引けで売り`] : []),
    ...(s.strategy !== "gapopen" ? [`${s.overnightSymbols.length > 0 ? `${s.overnightSymbols.join("・")} を` : ""}${s.overnightWeekdays.length > 0 ? `${s.overnightWeekdays.map((d) => "日月火水木金土"[d]).join("・")}曜の` : ""}${s.overnightMinPct > -100 ? `場中に${s.overnightMinPct}%以上上げたら` : ""}引けで買い、翌朝の寄りで売り${s.overnightSkipUsHolidays ? "（米国が休みの日は買わない）" : ""}`] : []),
  ];
  console.log(`${result.symbol}  ${DAILY[s.strategy as keyof typeof DAILY]}（${rules.join("／")}）  日足 × ${range}  ${s.shares}株  損失上限 ${s.dailyLossLimitYen}円${s.maxPositionYen > 0 ? `  買付上限 ${s.maxPositionYen}円` : ""}${s.overnightMaxPositionYen > 0 ? `  持ち越しの買付上限 ${s.overnightMaxPositionYen}円` : ""}`);
  console.log(`日数 ${m.days}  合計 ${yen(m.totalPnl)}  1日平均 ${yen(m.avgPnlPerDay)}  勝ち ${m.winDays}日  負け ${m.loseDays}日  取引なし・±0 ${m.flatDays}日`);
  console.log(`取引 ${m.trades}回  勝率 ${m.winRate == null ? "-" : `${(m.winRate * 100).toFixed(1)}%`}  PF ${m.profitFactor == null ? "-" : m.profitFactor.toFixed(2)}  最大DD ${yen(-m.maxDrawdown)}  最悪日 ${yen(m.worstDay)}  最良日 ${yen(m.bestDay)}`);
  if (s.strategy === "gapopen_overnight") {
    const part = (label: string, list: typeof result.trades) => {
      const win = list.filter((x) => x.pnl > 0);
      const loss = list.filter((x) => x.pnl < 0).reduce((a, x) => a - x.pnl, 0);
      console.log(`  ${label}  ${list.length}回  合計 ${yen(list.reduce((a, x) => a + x.pnl, 0))}  勝率 ${((win.length / Math.max(list.length, 1)) * 100).toFixed(1)}%  PF ${loss > 0 ? (win.reduce((a, x) => a + x.pnl, 0) / loss).toFixed(2) : "-"}`);
    };
    part("安寄り買い", result.trades.filter((x) => x.reason !== "next_open"));
    part("持ち越し　", result.trades.filter((x) => x.reason === "next_open"));
  }
  const plus = result.monthly.filter((x) => x.pnl > 0).length;
  const worstMonth = Math.min(...result.monthly.map((x) => x.pnl));
  console.log(`月 ${result.monthly.length}  プラスの月 ${plus}（${((plus / Math.max(result.monthly.length, 1)) * 100).toFixed(1)}%）  月平均 ${yen(m.totalPnl / Math.max(result.monthly.length, 1))}  最悪の月 ${yen(worstMonth)}`);
  const years = new Map<string, { pnl: number; trades: number; plus: number; months: number }>();
  for (const x of result.monthly) {
    const y = years.get(x.month.slice(0, 4)) ?? { pnl: 0, trades: 0, plus: 0, months: 0 };
    years.set(x.month.slice(0, 4), { pnl: y.pnl + x.pnl, trades: y.trades + x.trades, plus: y.plus + (x.pnl > 0 ? 1 : 0), months: y.months + 1 });
  }
  for (const [y, v] of years) console.log(`  ${y}  ${yen(v.pnl).padStart(10)}  ${String(v.trades).padStart(4)}回  プラスの月 ${v.plus}/${v.months}`);
  if (args.includes("--monthly")) for (const x of result.monthly) console.log(`  ${x.month}  ${yen(x.pnl).padStart(9)}  ${x.days}日  ${x.trades}回`);
  process.exit(0);
}

const symbol = normalizeSymbol(symbolArg);
const settings = parseSettings(overrides, DEFAULT_SETTINGS);
const synthetic = args.includes("--synthetic");
const interval = (flag("interval") ?? "5m") as Interval;
const range = (flag("range") ?? "60d") as Range;

const bars = await getProvider(synthetic ? "synthetic" : "yahoo").intraday(symbol, interval, range, Math.floor(Date.now() / 1000));
const result = runBacktest(symbol, bars, settings);
const s = result.summary;
console.log(`${symbol}  ${settings.strategy}${settings.entryOrder === "limit" ? `（指値・${settings.limitWaitBars}本待ち）` : ""}  ${interval} × ${range}  ${synthetic ? "【合成データ】" : "Yahoo Finance"}`);
console.log(`日数 ${s.days}  合計 ${yen(s.totalPnl)}  1日平均 ${yen(s.avgPnlPerDay)}`);
console.log(`目標達成 ${s.targetDays}日  損失上限 ${s.lossLimitDays}日  勝ち ${s.winDays}日  負け ${s.loseDays}日  取引なし・±0 ${s.flatDays}日`);
console.log(
  `取引 ${s.trades}回  勝率 ${s.winRate == null ? "-" : `${(s.winRate * 100).toFixed(1)}%`}  PF ${s.profitFactor == null ? "-" : s.profitFactor.toFixed(2)}  最大DD ${yen(-s.maxDrawdown)}  最悪日 ${yen(s.worstDay)}  最良日 ${yen(s.bestDay)}`,
);
if (result.tickMismatch) console.log(`注意: 株価が${result.fineTick ? "細かい" : "通常の"}呼値の刻みに合っていません。fineTickSymbols の設定を確認してください（--fine-tick / --standard-tick）。`);
if (result.missingOpenDays > 0) console.log(`注意: ${s.days}日のうち${result.missingOpenDays}日は 9:00 の足がありません。その日は 9:05 以降の足だけで計算しています。`);
for (const m of result.monthly) console.log(`  ${m.month}  ${yen(m.pnl).padStart(8)}  ${m.days}日  ${m.trades}回`);
for (const d of result.daily) console.log(`  ${d.date}  ${yen(d.pnl).padStart(8)}  ${d.trades}回  ${d.halted ?? ""}`);
