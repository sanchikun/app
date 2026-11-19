import { describe, expect, it } from "vitest";
import { bucketByFeature, dayFeatures, stats, tercileCuts } from "../src/core/screen";
import type { DayFeatures, Observation } from "../src/core/screen";
import { DEFAULT_SETTINGS } from "../src/core/types";
import type { Bar, Settings } from "../src/core/types";
import { parseYahooChart } from "../src/data/provider";

const S: Settings = { ...DEFAULT_SETTINGS, orbMinutes: 15, shares: 100, dailyLossLimitYen: 1000 };
// 2026-11-02 は月曜。09:00 JST
const DAY0 = Date.UTC(2026, 10, 2, 0, 0, 0) / 1000;

/** day 日目に、寄り付きレンジ3本（値幅 range、出来高 vol ずつ）とその後の1本を作る */
function day(d: number, open: number, range: number, vol: number): Bar[] {
  const t = DAY0 + d * 86400;
  return [
    { t, o: open, h: open + range, l: open, c: open + 1, v: vol },
    { t: t + 300, o: open + 1, h: open + 2, l: open, c: open + 1, v: vol },
    { t: t + 600, o: open + 1, h: open + 2, l: open, c: open + 2, v: vol },
    { t: t + 900, o: open + 2, h: open + range + 50, l: open, c: open + 10, v: vol * 100 },
  ];
}

describe("dayFeatures", () => {
  const bars = [...day(0, 1000, 10, 100), ...day(1, 1000, 10, 100), ...day(2, 1000, 10, 100), ...day(3, 1030.3, 20, 300)];
  const f = dayFeatures(bars, S, true, 10, 3);

  it("過去が足りない日は比率を出さない", () => {
    expect(f[0].gapPct).toBeNull();
    expect(f[2].orVolRatio).toBeNull();
    expect(f[2].gapPct).toBeCloseTo((10 / 1010) * 100);
  });

  it("寄り付きレンジの足だけで当日の指標を計算する", () => {
    const d = f[3];
    expect(d.orVolRatio).toBeCloseTo(3); // レンジ後の足の出来高は数えない
    expect(d.orRangeRatio).toBeCloseTo(2);
    expect(d.orRangePct).toBeCloseTo((20 / 1030.3) * 100);
    expect(d.gapPct).toBeCloseTo((20.3 / 1010) * 100);
    expect(d.orRangeTicks).toBeCloseTo(40); // 1,000円超の細かい呼値は0.5円
    expect(d.stopFit).toBeCloseTo(1); // レンジの半分10円 ÷ 損失枠10円
  });
});

describe("集計", () => {
  const obs = (v: number, tradePnls: number[]): Observation => ({ symbol: "X", date: "2026-11-02", features: { gapPct: v } as DayFeatures, tradePnls, tradeRets: tradePnls.map((p) => p / 100000) });

  it("3等分の境界で 低・中・高 に分ける", () => {
    expect(tercileCuts([5, 1, 3, 2, 6, 4])).toEqual([3, 5]);
    const rows = bucketByFeature([obs(1, [100]), obs(3, [-50, -50]), obs(9, [300, -100]), { ...obs(0, [999]), features: { gapPct: null } as DayFeatures }], "gapPct", [3, 5]);
    expect(rows.map((r) => r.days)).toEqual([1, 1, 1]);
    expect(rows.map((r) => r.pnl)).toEqual([100, -100, 200]);
    expect(rows[2].profitFactor).toBe(3);
  });

  it("取引のない日は日数にだけ数える", () => {
    const s = stats("x", [obs(1, []), obs(2, [100])]);
    expect(s).toMatchObject({ days: 2, trades: 1, pnl: 100, pnlPerDay: 50, winRate: 1, profitFactor: null });
  });
});

describe("parseYahooChart", () => {
  it("単精度の誤差を0.1円刻みに戻す", () => {
    const v = 162.39999389648438;
    const bars = parseYahooChart({ chart: { result: [{ timestamp: [DAY0], indicators: { quote: [{ open: [v], high: [v], low: [v], close: [v], volume: [1] }] } }] } });
    expect(bars[0]).toMatchObject({ o: 162.4, h: 162.4, l: 162.4, c: 162.4 });
  });
});

describe("ギャップ埋めの日足検証", async () => {
  const { gapFadeDaily, summarize } = await import("../src/core/gapstudy");
  const { parseYahooDaily } = await import("../src/data/provider");
  const opt = { minGapPct: 1, slippageTicks: 0, useStops: true };
  const prev = { date: "2026-11-02", o: 2000, h: 2000, l: 2000, c: 2000 };

  it("前日終値に届けば利確、同じ幅だけ下げれば損切り、どちらでもなければ終値", () => {
    const t = (b: object) => gapFadeDaily("X", [prev, { date: "2026-11-04", o: 1960, h: 1960, l: 1960, c: 1960, ...b }], opt)[0];
    expect(t({ h: 2001, c: 1990 })).toMatchObject({ exit: "target", gapPct: -2 });
    expect(t({ h: 2001, c: 1990 }).ret).toBeCloseTo(40 / 1960);
    expect(t({ h: 2001, l: 1920 })).toMatchObject({ exit: "stop" }); // 両方に届いた日は損切り
    expect(t({ h: 1985, c: 1980 }).ret).toBeCloseTo(20 / 1960);
  });

  it("ギャップが小さい日は入らず、権利落ち日は配当を引いて測る", () => {
    expect(gapFadeDaily("X", [prev, { date: "2026-11-04", o: 1985, h: 1990, l: 1980, c: 1985 }], opt)).toHaveLength(0);
    expect(gapFadeDaily("X", [prev, { date: "2026-11-04", o: 1975, h: 1980, l: 1970, c: 1975, dividend: 20 }], opt)).toHaveLength(0);
  });

  it("同じ日の取引は1つにまとめて平均する", () => {
    const s = summarize([
      { symbol: "A", date: "d1", gapPct: -1, ret: 0.01, exit: "target" },
      { symbol: "B", date: "d1", gapPct: -1, ret: 0.03, exit: "target" },
      { symbol: "A", date: "d2", gapPct: -1, ret: -0.01, exit: "stop" },
    ]);
    expect(s).toMatchObject({ trades: 3, days: 2, profitFactor: 4, winDayRate: 0.5 });
    expect(s.avgBp).toBeCloseTo(100);
    expect(s.avgDayBp).toBeCloseTo(50);
  });

  it("日足に権利落ち日の配当を付ける", () => {
    const t = Date.UTC(2026, 8, 29) / 1000;
    const bars = parseYahooDaily({ chart: { result: [{ timestamp: [t], indicators: { quote: [{ open: [100], high: [101], low: [99], close: [100] }] }, events: { dividends: { [t]: { amount: 2.5, date: t } } } }] } });
    expect(bars).toEqual([{ date: "2026-09-29", o: 100, h: 101, l: 99, c: 100, dividend: 2.5 }]);
  });
});

describe("日足のルール検証", async () => {
  const { DAILY_RULES, marketGaps, runRule } = await import("../src/core/dailystudy");
  const rule = (key: string) => DAILY_RULES.find((r) => r.key === key)!;
  const d0 = { date: "2026-11-02", o: 2000, h: 2010, l: 1990, c: 2000 };
  const run = (key: string, day: object) => {
    const bars = [d0, { date: "2026-11-04", o: 2000, h: 2000, l: 2000, c: 2000, ...day }];
    return runRule(rule(key), "X", bars, marketGaps([["X", bars]]));
  };

  it("寄り付きで入るルールは始値から終値までの損益率になる", () => {
    expect(run("gap-down", { o: 1970, h: 1990, l: 1960, c: 1989.7 })[0].ret).toBeCloseTo(19.7 / 1970);
    expect(run("gap-down", { o: 1990, h: 1995, l: 1985, c: 1990 })).toHaveLength(0);
    expect(run("gap-up", { o: 2030, h: 2040, l: 2010, c: 2020 })[0].ret).toBeCloseTo(10 / 2030);
  });

  it("逆指値は1ティック抜けたら滑りを加えて約定する", () => {
    // 前日高値 2010、細かい呼値は0.5円。2010.5 で発動し 2011 で約定
    expect(run("break-high", { h: 2010, c: 2005 })).toHaveLength(0);
    expect(run("break-high", { h: 2020, c: 2015 })[0].ret).toBeCloseTo(4 / 2011);
    expect(run("break-high", { o: 2015, h: 2020, l: 2012, c: 2018 })[0].ret).toBeCloseTo(3 / 2015);
  });

  it("指値は1ティック以上抜けた日だけ、指値の値段で約定する", () => {
    // 前日安値 1990 に買い指値
    expect(run("fade-low", { l: 1990, c: 1995 })).toHaveLength(0);
    expect(run("fade-low", { l: 1989.5, c: 1995 })[0].ret).toBeCloseTo(5 / 1990);
    expect(run("fade-low", { o: 1985, h: 1996, l: 1980, c: 1995 })[0].ret).toBeCloseTo(10 / 1985);
  });

  it("権利落ち日は配当の分だけ前日の値を下げて比べる", () => {
    expect(run("fade-low", { o: 1985, h: 1986, l: 1965, c: 1980, dividend: 20 })[0].ret).toBeCloseTo(10 / 1970);
    expect(run("gap-down", { o: 1975, h: 1980, l: 1970, c: 1978, dividend: 20 })).toHaveLength(0);
  });
});

describe("損切りと分足での確認", async () => {
  const { DAILY_RULES, marketGaps, runRule } = await import("../src/core/dailystudy");
  const { fadeFill, fadeReturn } = await import("../src/core/fadecheck");
  const d0 = { date: "2026-11-02", o: 2000, h: 2010, l: 1990, c: 2000 };
  const T = Date.UTC(2026, 10, 4, 0, 0, 0) / 1000;
  const b5 = (n: number, l: number): Bar => ({ t: T + n * 300, o: 2000, h: 2000, l, c: 2000, v: 1 });

  it("日足: 約定値から指定の%下げた日は1ティック滑って損切りし、逆指値で入るルールには付けない", () => {
    const run = (key: string, day: object, stop?: number) => {
      const bars = [d0, { date: "2026-11-04", o: 2000, h: 2000, l: 2000, c: 2000, ...day }];
      return runRule(DAILY_RULES.find((r) => r.key === key)!, "X", bars, marketGaps([["X", bars]]), 1, stop);
    };
    // 1970 で寄り、1% 下の 1950.3 を割る。0.5円刻みなので 1949.8 で決済
    expect(run("gap-down", { o: 1970, h: 1975, l: 1940, c: 1972 }, 1)[0].ret).toBeCloseTo((1949.8 - 1970) / 1970);
    expect(run("gap-down", { o: 1970, h: 1975, l: 1955, c: 1972 }, 1)[0].ret).toBeCloseTo(2 / 1970);
    expect(run("break-high", { h: 2020, l: 1900, c: 2015 }, 1)[0].ret).toBeCloseTo(4 / 2011);
  });

  it("分足: 寄り付き、場中、欠けた時間帯の約定を区別する", () => {
    const base = { limit: 1990, tick: 0.5, open: 2000, low: 1995, bars: [b5(1, 1995), b5(2, 1989.5), b5(3, 1980)] };
    expect(fadeFill(base)).toMatchObject({ kind: "intraday", t: T + 600, entry: 1990, lowAfter: 1980 });
    expect(fadeFill({ ...base, open: 1985, low: 1975 })).toMatchObject({ kind: "open", entry: 1985, lowAfter: 1975 });
    expect(fadeFill({ ...base, bars: [b5(1, 1990)], low: 1988 })).toMatchObject({ kind: "missing-bar", t: null, entry: 1990, lowAfter: 1988 });
    expect(fadeFill({ ...base, bars: [b5(1, 1990)], low: 1990 })).toBeNull();
  });

  it("分足: 損切りは約定後の最安値で判定する", () => {
    const fill = { kind: "intraday" as const, t: T, entry: 2000, lowAfter: 1985 };
    expect(fadeReturn(fill, 2010, 0.5)).toBeCloseTo(0.005);
    expect(fadeReturn(fill, 2010, 0.5, 1)).toBeCloseTo(0.005);
    expect(fadeReturn(fill, 2010, 0.5, 0.5)).toBeCloseTo((1989.5 - 2000) / 2000);
  });
});
