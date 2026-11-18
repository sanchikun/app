import { finishDay, newDay, processBar } from "./engine";
import { groupByDate } from "./market";
import type { Bar, HaltReason, Settings, Trade } from "./types";

export interface DayResult {
  date: string;
  pnl: number;
  trades: number;
  halted: HaltReason | null;
}

export interface BacktestResult {
  symbol: string;
  summary: {
    days: number;
    totalPnl: number;
    avgPnlPerDay: number;
    /** 日次目標に届いた日数 */
    targetDays: number;
    /** 日次損失上限に達した日数 */
    lossLimitDays: number;
    winDays: number;
    loseDays: number;
    flatDays: number;
    trades: number;
    winRate: number | null;
    /** 総利益 ÷ 総損失。損失がなければ null */
    profitFactor: number | null;
    maxDrawdown: number;
    worstDay: number;
    bestDay: number;
  };
  daily: DayResult[];
  trades: Trade[];
}

export function runBacktest(symbol: string, bars: Bar[], settings: Settings): BacktestResult {
  const daily: DayResult[] = [];
  const trades: Trade[] = [];
  for (const [date, dayBars] of groupByDate(bars)) {
    const state = newDay(date);
    for (const bar of dayBars) trades.push(...processBar(state, settings, symbol, bar));
    trades.push(...finishDay(state, settings));
    daily.push({ date, pnl: state.realizedPnl, trades: state.tradeCount, halted: state.halted });
  }

  const totalPnl = daily.reduce((a, d) => a + d.pnl, 0);
  const grossWin = trades.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const grossLoss = trades.filter((t) => t.pnl < 0).reduce((a, t) => a - t.pnl, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const d of daily) {
    equity += d.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const pnls = daily.map((d) => d.pnl);

  return {
    symbol,
    summary: {
      days: daily.length,
      totalPnl,
      avgPnlPerDay: daily.length ? totalPnl / daily.length : 0,
      targetDays: daily.filter((d) => d.halted === "target").length,
      lossLimitDays: daily.filter((d) => d.halted === "loss_limit").length,
      winDays: daily.filter((d) => d.pnl > 0).length,
      loseDays: daily.filter((d) => d.pnl < 0).length,
      flatDays: daily.filter((d) => d.pnl === 0).length,
      trades: trades.length,
      winRate: trades.length ? trades.filter((t) => t.pnl > 0).length / trades.length : null,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      maxDrawdown,
      worstDay: pnls.length ? Math.min(...pnls) : 0,
      bestDay: pnls.length ? Math.max(...pnls) : 0,
    },
    daily,
    trades,
  };
}
