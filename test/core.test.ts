import { describe, expect, it } from "vitest";
import { runBacktest } from "../src/core/backtest";
import { finishDay, newDay, processBar } from "../src/core/engine";
import { inSession, jstDate, jstMinutes, roundToTick, tickMismatchRate, tickSize } from "../src/core/market";
import { orb, vwap } from "../src/core/strategy";
import { DEFAULT_SETTINGS, normalizeSymbol, parseSettings } from "../src/core/types";
import type { Bar, Settings } from "../src/core/types";
import { parseYahooChart, synthetic } from "../src/data/provider";

// 2026-11-18 09:00 JST
const OPEN = Date.UTC(2026, 10, 18, 0, 0, 0) / 1000;
const S: Settings = { ...DEFAULT_SETTINGS, fineTickSymbols: [], slippageTicks: 0, orbMinutes: 15, dailyTargetYen: 100, dailyLossLimitYen: 600 };
const SYM = "7203.T";

/** 5分足を n 本目の位置に作る */
function bar(n: number, o: number, h: number, l: number, c: number): Bar {
  return { t: OPEN + n * 300, o, h, l, c, v: 1000 };
}

/** レンジ 1000-1010 を作ったあと、4本目の終値で上抜ける */
const breakout = [
  bar(0, 1000, 1010, 1000, 1005),
  bar(1, 1005, 1010, 1002, 1006),
  bar(2, 1006, 1009, 1003, 1008),
  bar(3, 1008, 1013, 1007, 1012),
];

function run(bars: Bar[], s: Settings = S) {
  const state = newDay(jstDate(OPEN));
  const trades = bars.flatMap((b) => processBar(state, s, SYM, b));
  return { state, trades };
}

describe("market", () => {
  it("converts to JST", () => {
    expect(jstDate(OPEN)).toBe("2026-11-18");
    expect(jstMinutes(OPEN)).toBe(540);
    expect(jstDate(OPEN - 1)).toBe("2026-11-18");
    expect(jstDate(OPEN - 9 * 3600 - 1)).toBe("2026-11-17");
  });
  it("knows the trading session", () => {
    expect(inSession(OPEN)).toBe(true);
    expect(inSession(OPEN + 150 * 60)).toBe(false); // 11:30
    expect(inSession(OPEN + 210 * 60)).toBe(true); // 12:30
    expect(inSession(OPEN + 389 * 60)).toBe(true); // 15:29
    expect(inSession(OPEN + 390 * 60)).toBe(false); // 15:30
  });
  it("rounds to ticks", () => {
    expect(tickSize(2500)).toBe(1);
    expect(tickSize(4000)).toBe(5);
    expect(roundToTick(4003, "down")).toBe(4000);
    expect(roundToTick(4003, "up")).toBe(4005);
    expect(roundToTick(1234.4)).toBe(1234);
  });
  it("uses the finer TOPIX500 ticks when asked", () => {
    expect(tickSize(999, true)).toBe(0.1);
    expect(tickSize(2500, true)).toBe(0.5);
    expect(tickSize(3405, true)).toBe(1);
    expect(tickSize(12000, true)).toBe(5);
    expect(roundToTick(999.57, "down", true)).toBe(999.5);
    expect(roundToTick(2500.3, "up", true)).toBe(2500.5);
    expect(roundToTick(3403, "down", true)).toBe(3403);
    const bars = [3402, 3403, 3405, 3407].map((c, i) => bar(i, c, c, c, c));
    expect(tickMismatchRate(bars, false)).toBe(0.75);
    expect(tickMismatchRate(bars, true)).toBe(0);
  });
});

describe("strategies", () => {
  it("orb fires only on the bar that closes above the range", () => {
    expect(orb(breakout.slice(0, 3), S)).toBeNull();
    // 損切り幅 = max(レンジ半分 5, 2ティック) = 5
    expect(orb(breakout, S)).toEqual({ side: "long", stop: 1007, target: 1017 });
    expect(orb([...breakout, bar(4, 1012, 1015, 1011, 1014)], S)).toBeNull();
  });
  it("orb shorts only when allowed", () => {
    const down = [...breakout.slice(0, 3), bar(3, 1008, 1008, 995, 996)];
    expect(orb(down, S)).toBeNull();
    expect(orb(down, { ...S, allowShort: true })).toEqual({ side: "short", stop: 1001, target: 991 });
  });
  it("vwap buys a sharp drop below vwap", () => {
    const flat = Array.from({ length: 12 }, (_, i) => bar(i, 1000, 1001, 999, i % 2 ? 1001 : 999));
    expect(vwap(flat, S)).toBeNull();
    const signal = vwap([...flat, bar(12, 1000, 1000, 989, 990)], S);
    expect(signal?.side).toBe("long");
    expect(signal!.target).toBeGreaterThan(990);
    expect(signal!.stop).toBeLessThan(990);
  });
});

describe("engine", () => {
  it("fills at the next bar's open and takes profit", () => {
    const { state, trades } = run([...breakout, bar(4, 1013, 1018, 1012, 1016)]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ entryPrice: 1013, exitPrice: 1017, pnl: 400, reason: "take_profit" });
    expect(state.halted).toBe("target");
    expect(state.position).toBeNull();
  });
  it("keeps trading after a win when there is no profit cap", () => {
    const { state } = run([...breakout, bar(4, 1013, 1018, 1012, 1016)], { ...S, dailyTargetYen: 0 });
    expect(state.realizedPnl).toBe(400);
    expect(state.halted).toBeNull();
  });
  it("does not enter before the signal bar's successor", () => {
    const { state } = run(breakout);
    expect(state.position).toBeNull();
    expect(state.pending).toMatchObject({ symbol: SYM, side: "long" });
  });
  it("prefers the stop when a bar touches both stop and target", () => {
    const { trades } = run([...breakout, bar(4, 1013, 1018, 1006, 1010)]);
    expect(trades[0]).toMatchObject({ exitPrice: 1007, pnl: -600, reason: "stop_loss" });
  });
  it("fills a gapped stop at the open", () => {
    const { trades } = run([...breakout, bar(4, 1013, 1014, 1010, 1012), bar(5, 1002, 1003, 1000, 1001)]);
    expect(trades[0]).toMatchObject({ exitPrice: 1002, reason: "stop_loss" });
  });
  it("applies slippage to market orders but not to the take-profit limit", () => {
    const s = { ...S, slippageTicks: 1, dailyLossLimitYen: 1000 };
    const win = run([...breakout, bar(4, 1013, 1018, 1012, 1016)], s).trades[0];
    expect(win).toMatchObject({ entryPrice: 1014, exitPrice: 1017, pnl: 300 });
    const loss = run([...breakout, bar(4, 1013, 1014, 1006, 1008)], s).trades[0];
    expect(loss).toMatchObject({ entryPrice: 1014, exitPrice: 1006, pnl: -800 });
  });
  it("sizes slippage and the stop with the symbol's own tick", () => {
    const up = breakout.map((b) => ({ ...b, o: b.o + 2400, h: b.h + 2400, l: b.l + 2400, c: b.c + 2400 }));
    const next = bar(4, 3413, 3415, 3411, 3414);
    const s = { ...S, slippageTicks: 1, dailyLossLimitYen: 1000 };
    // 通常の呼値: 5円刻み → 約定 3418、損切りは 3413 にしか置けず、同じ足で損切りにかかる
    expect(run([...up, next], s).trades[0]).toMatchObject({ entryPrice: 3418, exitPrice: 3408, pnl: -1000, reason: "stop_loss" });
    // 細かい呼値: 1円刻み → 約定 3414、戦略の損切り 3407 がそのまま使える
    expect(run([...up, next], { ...s, fineTickSymbols: [SYM] }).state.position).toMatchObject({ entryPrice: 3414, stop: 3407 });
  });
  it("charges commission on both sides", () => {
    const { trades } = run([...breakout, bar(4, 1013, 1018, 1012, 1016)], { ...S, commissionPerOrderYen: 50, dailyLossLimitYen: 1000 });
    expect(trades[0].pnl).toBe(300);
  });
  it("skips the entry when the open is already past the target", () => {
    const { state, trades } = run([...breakout, bar(4, 1020, 1022, 1019, 1021)]);
    expect(trades).toHaveLength(0);
    expect(state.position).toBeNull();
  });
  it("halts at the loss limit and takes no further entries", () => {
    const { state } = run([...breakout, bar(4, 1013, 1014, 1006, 1008)]);
    expect(state.halted).toBe("loss_limit");
    // もう一度ブレイクしても新規は出ない
    processBar(state, S, SYM, bar(5, 1008, 1009, 1007, 1009));
    processBar(state, S, SYM, bar(6, 1009, 1015, 1009, 1014));
    expect(state.pending).toBeNull();
  });
  it("tightens the stop to fit the remaining loss budget", () => {
    const { state } = run([...breakout, bar(4, 1013, 1015, 1010, 1014)], { ...S, dailyLossLimitYen: 500 });
    expect(state.position).toMatchObject({ entryPrice: 1013, stop: 1008, target: 1017 });
    const withSlip = run([...breakout, bar(4, 1013, 1015, 1012, 1014)], { ...S, dailyLossLimitYen: 500, slippageTicks: 1 });
    // 約定 1014、滑り1円込みで最大5円の損失 → 損切りは 1010
    expect(withSlip.state.position).toMatchObject({ entryPrice: 1014, stop: 1010 });
  });
  it("skips the entry when the loss budget is smaller than one tick", () => {
    const { state } = run([...breakout, bar(4, 1013, 1015, 1010, 1014)], { ...S, dailyLossLimitYen: 50 });
    expect(state.position).toBeNull();
  });
  it("force-closes at the open of the first bar at or after forceCloseAt", () => {
    const s = { ...S, forceCloseAt: "09:30" };
    const { trades } = run([...breakout, bar(4, 1013, 1015, 1010, 1014), bar(5, 1014, 1015, 1011, 1012), bar(6, 1011, 1012, 1010, 1011)], s);
    expect(trades[0]).toMatchObject({ exitPrice: 1011, reason: "force_close", pnl: -200 });
  });
  it("does not enter after noEntryAfter", () => {
    const { state } = run([...breakout, bar(4, 1013, 1018, 1012, 1016)], { ...S, noEntryAfter: "09:20" });
    expect(state.position).toBeNull();
    expect(state.tradeCount).toBe(0);
  });
  it("closes a leftover position at the last close", () => {
    const { state } = run([...breakout, bar(4, 1013, 1015, 1010, 1014)]);
    expect(finishDay(state, S)[0]).toMatchObject({ exitPrice: 1014, reason: "eod", pnl: 100 });
    expect(finishDay(state, S)).toEqual([]);
  });
  it("holds at most one position across symbols", () => {
    const state = newDay(jstDate(OPEN));
    for (const b of [...breakout, bar(4, 1013, 1015, 1010, 1014)]) processBar(state, S, SYM, b);
    expect(state.position?.symbol).toBe(SYM);
    for (const b of breakout) processBar(state, S, "6758.T", b);
    expect(state.pending).toBeNull();
    expect(state.position?.symbol).toBe(SYM);
  });
});

describe("backtest", () => {
  it("summarises days and trades", () => {
    const day2 = [...breakout, bar(4, 1013, 1014, 1006, 1008)].map((b) => ({ ...b, t: b.t + 86400 }));
    const r = runBacktest(SYM, [...breakout, bar(4, 1013, 1018, 1012, 1016), ...day2], S);
    expect(r.daily.map((d) => d.pnl)).toEqual([400, -600]);
    expect(r.summary).toMatchObject({
      days: 2,
      totalPnl: -200,
      targetDays: 1,
      lossLimitDays: 1,
      trades: 2,
      winRate: 0.5,
      maxDrawdown: 600,
      worstDay: -600,
      bestDay: 400,
    });
    expect(r.summary.profitFactor).toBeCloseTo(400 / 600);
    expect(r.monthly).toEqual([{ month: "2026-11", pnl: -200, days: 2, trades: 2 }]);
  });
  it("runs on synthetic data without lookahead-dependent state", async () => {
    const now = OPEN + 8 * 3600; // 17:00 JST、当日分まで確定
    const bars = await synthetic.intraday(SYM, "5m", "60d", now);
    expect(bars.length).toBe(60 * 66);
    expect(await synthetic.intraday(SYM, "5m", "60d", now)).toEqual(bars);
    const r = runBacktest(SYM, bars, DEFAULT_SETTINGS);
    expect(r.summary.days).toBe(60);
    expect(r.summary.totalPnl).toBeCloseTo(r.trades.reduce((a, t) => a + t.pnl, 0));
    for (const t of r.trades) expect(t.exitT).toBeGreaterThanOrEqual(t.entryT);
  });
});

describe("inputs", () => {
  it("validates settings", () => {
    expect(parseSettings({ shares: 200 }).shares).toBe(200);
    expect(parseSettings({ symbols: ["7203", "6758.t"] }).symbols).toEqual(["7203.T", "6758.T"]);
    expect(parseSettings({ dailyTargetYen: 0 }).dailyTargetYen).toBe(0);
    expect(parseSettings({ fineTickSymbols: ["6758"] }).fineTickSymbols).toEqual(["6758.T"]);
    expect(() => parseSettings({ shares: 0 })).toThrow();
    expect(() => parseSettings({ strategy: "x" })).toThrow();
    expect(() => parseSettings({ forceCloseAt: "25:00" })).toThrow();
    expect(() => normalizeSymbol("../etc")).toThrow();
  });
  it("parses a yahoo chart response and drops empty bars", () => {
    const bars = parseYahooChart({
      chart: {
        result: [
          {
            timestamp: [OPEN, OPEN + 60, OPEN + 120],
            indicators: { quote: [{ open: [1, null, 3], high: [2, null, 4], low: [1, null, 2], close: [2, null, 3], volume: [10, null, null] }] },
          },
        ],
        error: null,
      },
    });
    expect(bars).toEqual([
      { t: OPEN, o: 1, h: 2, l: 1, c: 2, v: 10 },
      { t: OPEN + 120, o: 3, h: 4, l: 2, c: 3, v: 0 },
    ]);
    expect(() => parseYahooChart({ chart: { error: { description: "No data found" } } })).toThrow("No data found");
  });
});

describe("指値での新規", () => {
  // breakout の4本目（終値 1012）でシグナル。指値 1012、損切り 1007、利確 1017
  const L: Settings = { ...S, entryOrder: "limit", limitWaitBars: 2, dailyTargetYen: 0 };

  it("指値を1ティック抜けたら指値の値段で約定する", () => {
    const { state } = run([...breakout, bar(4, 1013, 1015, 1011, 1014)], L);
    expect(state.position).toMatchObject({ entryPrice: 1012, stop: 1007, target: 1017 });
    expect(state.pending).toBeNull();
  });

  it("同値に触れただけでは約定せず、注文は残る", () => {
    const { state } = run([...breakout, bar(4, 1013, 1015, 1012, 1014)], L);
    expect(state.position).toBeNull();
    expect(state.pending?.limit).toEqual({ price: 1012, barsLeft: 1 });
  });

  it("待つ本数を過ぎたら取り消す", () => {
    const { state } = run([...breakout, bar(4, 1013, 1015, 1012, 1014), bar(5, 1014, 1016, 1013, 1015), bar(6, 1015, 1015, 1010, 1011)], L);
    expect(state.position).toBeNull();
  });

  it("約定する前に利確の値に届いたら取り消す", () => {
    const { state } = run([...breakout, bar(4, 1013, 1017, 1012, 1016)], L);
    expect(state.position).toBeNull();
    expect(state.pending).toBeNull();
  });

  it("約定した足では利確しないが、損切りはする", () => {
    const tp = run([...breakout, bar(4, 1013, 1018, 1011, 1016)], L);
    expect(tp.trades).toHaveLength(0);
    expect(tp.state.position?.entryPrice).toBe(1012);
    const sl = run([...breakout, bar(4, 1013, 1014, 1006, 1008)], L);
    expect(sl.trades).toMatchObject([{ entryPrice: 1012, exitPrice: 1007, reason: "stop_loss", pnl: -500 }]);
  });
});

describe("追加の戦略", () => {
  it("後場順張り: 前場が上げた日に後場の最初の足で買いシグナルを出す", async () => {
    const { momentum } = await import("../src/core/strategy");
    const morning = [bar(0, 1000, 1004, 1000, 1004), bar(1, 1004, 1010, 1004, 1010)];
    const afternoon = bar(42, 1010, 1012, 1009, 1011); // 12:30
    expect(momentum([...morning, afternoon], S, false)).toMatchObject({ side: "long", stop: 1006 });
    expect(momentum(morning, S, false)).toBeNull();
    expect(momentum([...morning, afternoon, bar(43, 1011, 1013, 1010, 1012)], S, false)).toBeNull();
    expect(momentum([...morning, bar(42, 1010, 1010, 1005, 1006)], S, false)).toBeNull();
  });

  it("ギャップ埋め: 前日終値より1%以上安く寄った日に、前日終値を利確にして買う", () => {
    const s: Settings = { ...S, strategy: "gapfade", dailyTargetYen: 0, dailyLossLimitYen: 100000 };
    const prevDay = { t: OPEN - 86400 + 6 * 3600, o: 1000, h: 1000, l: 1000, c: 1000, v: 1000 };
    const bars = [prevDay, bar(0, 985, 986, 984, 985), bar(1, 986, 990, 985, 989), bar(2, 989, 1001, 988, 1000)];
    const r = runBacktest(SYM, bars, s);
    expect(r.trades).toMatchObject([{ side: "long", entryPrice: 986, exitPrice: 1000, reason: "take_profit" }]);
    // 前日の足がなければ入らない
    expect(runBacktest(SYM, bars.slice(1), s).trades).toHaveLength(0);
  });
});

describe("安寄り買い", async () => {
  const { gapOpenTick, openQuote, runGapOpenBacktest, jstTime } = await import("../src/core/gapopen");
  const G: Settings = { ...DEFAULT_SETTINGS, strategy: "gapopen", fineTickSymbols: [], slippageTicks: 1, gapMinPct: 1, gapStopPct: 0.5, dailyLossLimitYen: 3000, symbols: ["1111.T", "2222.T"] };
  const NOW = OPEN + 3600;
  const q = (open: number, low: number, close: number) => ({ prevClose: 2000, open, low, close });

  it("1%以上安く寄った銘柄を寄り値で買い、0.5%下に損切りを置く", () => {
    const state = newDay("2026-11-18");
    expect(gapOpenTick(state, G, { "1111.T": q(1970, 1965, 1968) }, NOW, false)).toHaveLength(0);
    expect(state.position).toMatchObject({ symbol: "1111.T", entryPrice: 1970, stop: 1960, entryT: OPEN });
    expect(state.decided).toEqual(["1111.T"]);
  });

  it("gapPrevDropPct があれば、前日もそれ以上下げていた銘柄だけを買う", () => {
    const P = { ...G, gapPrevDropPct: 2 };
    const state = newDay("2026-11-18");
    // 1111 はギャップが大きいが前日は上げ、2222 は前日 -2.5%、3333 は前日の騰落が分からない
    gapOpenTick(state, P, { "1111.T": { ...q(1940, 1940, 1940), prevReturnPct: 1 }, "2222.T": { ...q(1970, 1965, 1968), prevReturnPct: -2.5 } }, NOW, false);
    expect(state.position?.symbol).toBe("2222.T");
    const unknown = newDay("2026-11-18");
    gapOpenTick(unknown, P, { "1111.T": q(1940, 1940, 1940) }, NOW, false);
    expect(unknown.position).toBeNull();
    // 日足から前日の騰落率を出す（権利落ち調整込み）
    const bars = [{ date: "d1", o: 1000, h: 1000, l: 1000, c: 1000 }, { date: "d2", o: 990, h: 990, l: 970, c: 970 }, { date: "d3", o: 955, h: 960, l: 950, c: 958 }];
    expect(openQuote(bars, 2)?.prevReturnPct).toBeCloseTo(-3);
    expect(openQuote(bars, 1)?.prevReturnPct).toBeUndefined();
  });

  it("ギャップが足りない銘柄は見送り、あとから入り直さない", () => {
    const state = newDay("2026-11-18");
    gapOpenTick(state, G, { "1111.T": q(1990, 1985, 1990) }, NOW, false);
    gapOpenTick(state, G, { "1111.T": q(1970, 1965, 1968) }, NOW, false);
    expect(state.position).toBeNull();
  });

  it("安値が損切りに届けば1ティック滑って決済し、届かなければ大引けの終値で決済する", () => {
    const stopped = newDay("2026-11-18");
    gapOpenTick(stopped, G, { "1111.T": q(1970, 1970, 1970) }, NOW, false);
    expect(gapOpenTick(stopped, G, { "1111.T": q(1970, 1955, 1990) }, NOW, false)).toMatchObject([{ exitPrice: 1959, reason: "stop_loss", pnl: -1100, exitT: NOW }]);
    const held = newDay("2026-11-18");
    expect(gapOpenTick(held, G, { "1111.T": q(1970, 1962, 1995) }, NOW, true)).toMatchObject([{ exitPrice: 1995, reason: "eod", pnl: 2500, exitT: jstTime("2026-11-18", 930) }]);
  });

  it("複数が条件に合えばギャップが最も大きい銘柄だけを買い、買付上限を超える銘柄は見送る", () => {
    const state = newDay("2026-11-18");
    gapOpenTick(state, G, { "1111.T": q(1975, 1975, 1975), "2222.T": q(1950, 1950, 1950) }, NOW, false);
    expect(state.position?.symbol).toBe("2222.T");
    const capped = newDay("2026-11-18");
    gapOpenTick(capped, { ...G, maxPositionYen: 196000 }, { "1111.T": q(1975, 1975, 1975), "2222.T": q(1950, 1950, 1950) }, NOW, false);
    expect(capped.position?.symbol).toBe("2222.T");
    const none = newDay("2026-11-18");
    gapOpenTick(none, { ...G, maxPositionYen: 190000 }, { "1111.T": q(1975, 1975, 1975) }, NOW, false);
    expect(none.position).toBeNull();
  });

  it("損切り幅は損失上限に収まるよう狭める", () => {
    const state = newDay("2026-11-18");
    gapOpenTick(state, { ...G, dailyLossLimitYen: 600 }, { "1111.T": q(1970, 1970, 1970) }, NOW, false);
    expect(state.position?.stop).toBe(1965);
  });

  it("日足のバックテスト: 配当落ちを調整し、日ごとに1回だけ取引する", () => {
    const bars = [
      { date: "2026-11-02", o: 2000, h: 2000, l: 2000, c: 2000 },
      { date: "2026-11-04", o: 1970, h: 1996, l: 1965, c: 1995 },
      { date: "2026-11-05", o: 1970, h: 1975, l: 1950, c: 1960, dividend: 20 },
      { date: "2026-11-06", o: 1930, h: 1940, l: 1900, c: 1935 },
    ];
    expect(openQuote(bars, 2)).toMatchObject({ prevClose: 1975 });
    const r = runGapOpenBacktest([["1111.T", bars]], G);
    expect(r.trades.map((t) => [t.date, t.reason, t.pnl])).toEqual([
      ["2026-11-04", "eod", 2500],
      ["2026-11-06", "stop_loss", -1100],
    ]);
    expect(r.summary).toMatchObject({ days: 3, trades: 2, totalPnl: 1400 });
  });
});

describe("上げた日の持ち越し", async () => {
  const { dailyTick, runGapOpenBacktest, jstTime } = await import("../src/core/gapopen");
  const O: Settings = { ...DEFAULT_SETTINGS, strategy: "gapopen_overnight", fineTickSymbols: [], slippageTicks: 1, dailyLossLimitYen: 3000, overnightMinPct: 2, symbols: ["1111.T", "2222.T"] };
  const q = (prevClose: number, open: number, low: number, close: number, dividend?: number) => ({ prevClose, open, low, close, ...(dividend ? { dividend } : {}) });

  it("大引け後、場中に2%以上上げた銘柄のうち最も上げたものを終値で買い、同じ日のうちは決済しない", () => {
    const state = newDay("2026-11-18");
    const quotes = { "1111.T": q(2000, 2000, 1995, 2050), "2222.T": q(1000, 1000, 1000, 1040) };
    expect(dailyTick(state, O, quotes, OPEN, false)).toHaveLength(0);
    expect(state.position).toBeNull();
    expect(dailyTick(state, O, quotes, OPEN, true)).toHaveLength(0);
    expect(state.position).toMatchObject({ symbol: "2222.T", entryPrice: 1040, overnight: true, entryT: jstTime("2026-11-18", 930) });
    // 大引け後にもう一度動いても、買い直しも決済もしない
    expect(dailyTick(state, O, quotes, OPEN, true)).toHaveLength(0);
    expect(state.position?.symbol).toBe("2222.T");
  });

  it("overnightWeekdays の曜日だけ買い、overnightSymbols の銘柄は持ち越しだけの対象にする", () => {
    const E: Settings = { ...O, overnightMinPct: -100, overnightWeekdays: [1], overnightSymbols: ["1306.T"] };
    // 1306 は1%以上安く寄っているが、安寄り買いの対象ではない
    const quotes = { "1306.T": q(400, 395, 394, 396), "1111.T": q(2000, 2000, 1995, 2050) };
    const wed = newDay("2026-11-18");
    expect(dailyTick(wed, E, quotes, OPEN, true)).toHaveLength(0);
    expect(wed.position).toBeNull();
    const mon = newDay("2026-11-16");
    expect(dailyTick(mon, E, quotes, OPEN, true)).toHaveLength(0);
    expect(mon.position).toMatchObject({ symbol: "1306.T", entryPrice: 396, overnight: true, shares: 100 });
    const lots = newDay("2026-11-16");
    dailyTick(lots, { ...E, overnightShares: 700 }, quotes, OPEN, true);
    expect(lots.position?.shares).toBe(700);
    expect(() => parseSettings({ overnightWeekdays: [6] }, DEFAULT_SETTINGS)).toThrow();
    expect(parseSettings({ overnightSymbols: ["1306"], overnightWeekdays: [1, 1] }, DEFAULT_SETTINGS)).toMatchObject({ overnightSymbols: ["1306.T"], overnightWeekdays: [1] });
  });

  it("買付上限を超える銘柄は見送り、条件に合う銘柄がなければ買わない", () => {
    const capped = newDay("2026-11-18");
    dailyTick(capped, { ...O, overnightMaxPositionYen: 150000 }, { "1111.T": q(2000, 2000, 1995, 2050), "2222.T": q(1000, 1000, 1000, 1030) }, OPEN, true);
    expect(capped.position?.symbol).toBe("2222.T");
    const none = newDay("2026-11-18");
    dailyTick(none, O, { "1111.T": q(2000, 2000, 1995, 2030) }, OPEN, true);
    expect(none.position).toBeNull();
    expect(none.overnightDecided).toBe(true);
  });

  it("翌朝の寄り付きで売り、配当落ち日は配当を含め、そのあと安寄り買いを判断する", () => {
    const state = newDay("2026-11-19");
    state.position = { symbol: "2222.T", side: "long", shares: 100, entryT: jstTime("2026-11-18", 930), entryPrice: 1040, stop: 0, target: 104000, overnight: true };
    // 持ち越した銘柄がまだ寄り付いていない間は、ほかの銘柄の判断を待つ
    expect(dailyTick(state, O, { "1111.T": q(2050, 2020, 2020, 2020) }, OPEN, false)).toHaveLength(0);
    expect(state.decided ?? []).toEqual([]);
    const trades = dailyTick(state, O, { "1111.T": q(2050, 2020, 2020, 2020), "2222.T": q(1030, 1045, 1045, 1045, 10) }, OPEN, false);
    expect(trades).toMatchObject([{ symbol: "2222.T", exitPrice: 1055, reason: "next_open", pnl: 1500, date: "2026-11-19" }]);
    expect(state.position).toMatchObject({ symbol: "1111.T", entryPrice: 2020 });
    expect(state.position?.overnight).toBeUndefined();
  });

  it("日足のバックテスト: 引けで買った分は次の日の寄り付きで決済し、損益はその日に付く", () => {
    const bars = [
      { date: "2026-11-02", o: 1000, h: 1000, l: 1000, c: 1000 },
      { date: "2026-11-04", o: 1000, h: 1032, l: 998, c: 1030 },
      { date: "2026-11-05", o: 1042, h: 1045, l: 1035, c: 1040 },
      { date: "2026-11-06", o: 1040, h: 1041, l: 1039, c: 1040 },
    ];
    const r = runGapOpenBacktest([["1111.T", bars]], { ...O, strategy: "overnight" });
    expect(r.trades.map((t) => [t.date, t.reason, t.entryPrice, t.exitPrice, t.pnl])).toEqual([["2026-11-05", "next_open", 1030, 1042, 1200]]);
    expect(r.daily.map((d) => d.pnl)).toEqual([0, 1200, 0]);
  });

  it("日足のバックテスト: 持ち越した翌日の足が壊れていたら、その取引は数えない", () => {
    const bars = [
      { date: "2026-11-02", o: 1000, h: 1000, l: 1000, c: 1000 },
      { date: "2026-11-04", o: 1000, h: 1032, l: 998, c: 1030 },
      // 桁が1つずれた日
      { date: "2026-11-05", o: 104, h: 105, l: 103, c: 104 },
      { date: "2026-11-06", o: 1040, h: 1041, l: 1039, c: 1040 },
      { date: "2026-11-09", o: 1040, h: 1041, l: 1039, c: 1040 },
    ];
    const r = runGapOpenBacktest([["1111.T", bars]], { ...O, strategy: "overnight" });
    expect(r.trades).toHaveLength(0);
  });
});
