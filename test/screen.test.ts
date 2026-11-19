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
  const obs = (v: number, tradePnls: number[]): Observation => ({ symbol: "X", date: "2026-11-02", features: { gapPct: v } as DayFeatures, tradePnls });

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
