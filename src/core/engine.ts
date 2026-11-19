import { cleanPrice, hhmmToMinutes, jstMinutes, tickSize } from "./market";
import { STRATEGIES } from "./strategy";
import type { Bar, DayState, ExitReason, Settings, Trade } from "./types";

/**
 * 1日分の売買シミュレーション。バックテストとペーパートレードで同じものを使う。
 *
 * 約定モデル:
 * - シグナルは足の確定時に出て、次の足の始値で成行約定する（先読みなし）。
 * - entryOrder が limit のときは、シグナルが出た足の終値に指値を置く。以降の足がその値を
 *   1ティックでも抜けたら指値の値段で約定とみなす（同値に触れただけでは順番待ちで約定しない
 *   ことがあるので数えない）。limitWaitBars 本のうちに約定しないか、先に利確の値に届いたら取り消す。
 *   約定した足では、高値が約定の前か後か分からないので利確は判定しない。
 * - 損切りと利確は足の高値・安値で判定する。同じ足で両方に届いた場合は損切りを優先する。
 * - 損切り時の損失がその日の残りの損失枠に収まるよう、約定時に損切り幅を狭める（窓開けは防げない）。
 * - 成行（新規・損切り・強制決済）には slippageTicks 分の不利な滑りを加える。利確は指値扱いで滑りなし。
 */

export function newDay(date: string): DayState {
  return { date, realizedPnl: 0, tradeCount: 0, halted: null, position: null, pending: null, bars: {} };
}

function closePosition(
  state: DayState,
  s: Settings,
  t: number,
  price: number,
  reason: ExitReason,
): Trade {
  const pos = state.position!;
  const dir = pos.side === "long" ? 1 : -1;
  price = cleanPrice(price);
  const pnl = Math.round(((price - pos.entryPrice) * dir * pos.shares - 2 * s.commissionPerOrderYen) * 100) / 100;
  const trade: Trade = {
    date: state.date,
    symbol: pos.symbol,
    side: pos.side,
    shares: pos.shares,
    entryT: pos.entryT,
    entryPrice: pos.entryPrice,
    exitT: t,
    exitPrice: price,
    pnl,
    reason,
  };
  state.position = null;
  state.realizedPnl = Math.round((state.realizedPnl + pnl) * 100) / 100;
  state.tradeCount += 1;
  if (s.dailyTargetYen > 0 && state.realizedPnl >= s.dailyTargetYen) state.halted = "target";
  else if (state.realizedPnl <= -s.dailyLossLimitYen) state.halted = "loss_limit";
  else if (state.tradeCount >= s.maxTradesPerDay) state.halted = "max_trades";
  return trade;
}

/** 確定した足を1本処理し、その足で決済された取引を返す。state を書き換える。 */
export function processBar(state: DayState, s: Settings, symbol: string, bar: Bar): Trade[] {
  const trades: Trade[] = [];
  const bars = (state.bars[symbol] ??= []);
  bars.push(bar);
  const mins = jstMinutes(bar.t);
  const canEnter = mins < hhmmToMinutes(s.noEntryAfter);
  const fine = s.fineTickSymbols.includes(symbol);
  const slip = s.slippageTicks * tickSize(bar.o, fine);

  // 1. 前の足で出たシグナルを約定させる（成行はこの足の始値、指値は値が抜けたとき）
  const pending = state.pending;
  let limitFilled = false;
  if (pending && pending.symbol === symbol) {
    state.pending = null;
    if (!state.position && !state.halted && canEnter) {
      const dir = pending.side === "long" ? 1 : -1;
      const limit = pending.limit;
      let fill: number | null = cleanPrice(bar.o + dir * slip);
      if (limit) {
        const through = dir === 1 ? bar.l < limit.price : bar.h > limit.price;
        const ranAway = dir === 1 ? bar.h >= pending.target : bar.l <= pending.target;
        if (through) fill = limit.price;
        else {
          fill = null;
          if (!ranAway && limit.barsLeft > 1) state.pending = { ...pending, limit: { price: limit.price, barsLeft: limit.barsLeft - 1 } };
        }
      }
      if (fill != null) {
        // 損切り時の損失がその日の残りの損失枠に収まるよう、損切り幅を狭める
        const tick = tickSize(bar.o, fine);
        const budget = s.dailyLossLimitYen + state.realizedPnl - 2 * s.commissionPerOrderYen;
        const maxDist = cleanPrice(Math.floor((budget / s.shares - slip) / tick + 1e-6) * tick);
        const stop = cleanPrice(dir === 1 ? Math.max(pending.stop, fill - maxDist) : Math.min(pending.stop, fill + maxDist));
        // 枠が1ティック分もない、または約定値がすでに損切り・利確の外側なら見送る
        const lo = Math.min(stop, pending.target);
        const hi = Math.max(stop, pending.target);
        if (maxDist >= tick && fill > lo && fill < hi) {
          state.position = {
            symbol,
            side: pending.side,
            shares: s.shares,
            entryT: bar.t,
            entryPrice: fill,
            stop,
            target: pending.target,
          };
          limitFilled = limit != null;
        }
      }
    }
  }

  // 2. 保有中のポジションの決済判定
  let exited = false;
  const pos = state.position;
  if (pos && pos.symbol === symbol) {
    const long = pos.side === "long";
    const dir = long ? 1 : -1;
    const enteredThisBar = pos.entryT === bar.t;
    if (!enteredThisBar && mins >= hhmmToMinutes(s.forceCloseAt)) {
      trades.push(closePosition(state, s, bar.t, bar.o - dir * slip, "force_close"));
    } else if (long ? bar.l <= pos.stop : bar.h >= pos.stop) {
      // 窓を開けて損切りを飛び越えた場合は始値で約定
      const base = long ? Math.min(pos.stop, bar.o) : Math.max(pos.stop, bar.o);
      trades.push(closePosition(state, s, bar.t, base - dir * slip, "stop_loss"));
    } else if (!limitFilled && (long ? bar.h >= pos.target : bar.l <= pos.target)) {
      const price = long ? Math.max(pos.target, bar.o) : Math.min(pos.target, bar.o);
      trades.push(closePosition(state, s, bar.t, price, "take_profit"));
    }
    exited = trades.length > 0;
  }

  // 3. 新しいシグナル（同時に持つのは1ポジションまで）
  if (!state.position && !state.pending && !state.halted && !exited && canEnter) {
    const signal = STRATEGIES[s.strategy](bars, s, fine, { prevClose: state.prevClose?.[symbol] });
    if (signal) {
      state.pending = s.entryOrder === "limit" ? { ...signal, symbol, limit: { price: bar.c, barsLeft: s.limitWaitBars } } : { ...signal, symbol };
    }
  }
  return trades;
}

/** 日の終わりに残ったポジションを最後の足の終値で決済する。 */
export function finishDay(state: DayState, s: Settings): Trade[] {
  state.pending = null;
  const pos = state.position;
  if (!pos) return [];
  const last = state.bars[pos.symbol]?.at(-1);
  if (!last) return [];
  const dir = pos.side === "long" ? 1 : -1;
  const slip = s.slippageTicks * tickSize(last.c, s.fineTickSymbols.includes(pos.symbol));
  return [closePosition(state, s, last.t, last.c - dir * slip, "eod")];
}
