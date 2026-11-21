import { describe, expect, it } from "vitest";
import { jstTime } from "../src/core/gapopen";
import type { DailyBar } from "../src/core/gapstudy";
import { DEFAULT_SETTINGS } from "../src/core/types";
import type { Bar, DayState, Settings } from "../src/core/types";
import type { DataProvider } from "../src/data/provider";
import { paperTick } from "../src/worker/paper";

/** D1 の代わり。paper.ts が使う文だけを解釈する */
function fakeDb(settings: Settings) {
  const days = new Map<string, string>();
  const trades: unknown[][] = [];
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => {
      if (sql.startsWith("SELECT json FROM settings")) return { json: JSON.stringify(settings) };
      if (sql.includes("WHERE date = ?")) return days.has(args[0] as string) ? { state_json: days.get(args[0] as string) } : null;
      if (sql.includes("WHERE date < ?")) { const d = [...days.keys()].filter((k) => k < (args[0] as string)).sort().pop(); return d ? { state_json: days.get(d) } : null; }
      throw new Error(`unexpected: ${sql}`);
    },
    run: async () => {
      if (sql.includes("INSERT INTO days")) days.set(args[0] as string, args[4] as string);
      else if (sql.includes("INSERT INTO trades")) trades.push(args);
      else throw new Error(`unexpected: ${sql}`);
    },
  });
  const db = { prepare: (sql: string) => stmt(sql), batch: async (list: { run: () => Promise<void> }[]) => { for (const s of list) await s.run(); } };
  return { db: db as unknown as D1Database, state: (d: string) => JSON.parse(days.get(d)!) as DayState, trades };
}

describe("ペーパートレード: 安寄り買いを2銘柄、損切りは 9:05 から、10:00 に売る", () => {
  const DATE = "2026-11-18";
  const at = (hhmm: string) => jstTime(DATE, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)));
  const S: Settings = { ...DEFAULT_SETTINGS, enabled: true, strategy: "gapopen", symbols: ["1111.T", "2222.T", "3333.T"], fineTickSymbols: [], dailyLossLimitYen: 3000, maxTradesPerDay: 5, gapMaxPositions: 2, gapPositionYen: 250000, maxPositionYen: 250000, gapExitAt: "10:00", gapStopFrom: "09:05" };
  // 5分足: [時刻, 始値, 安値, 終値]。1111 は 9:10 の足で損切りに届く。2222 は上げて 10:00 の足の始値 990 で売る
  const M: Record<string, [string, number, number, number][]> = {
    "1111.T": [["09:05", 1938, 1932, 1936], ["09:10", 1936, 1925, 1928], ["09:15", 1928, 1926, 1930], ["09:55", 1931, 1930, 1932], ["10:00", 1933, 1931, 1934], ["10:05", 1934, 1933, 1935]],
    "2222.T": [["09:05", 978, 976, 982], ["09:10", 982, 981, 985], ["09:15", 985, 984, 986], ["09:55", 988, 987, 990], ["10:00", 990, 989, 992], ["10:05", 992, 991, 993]],
  };
  const OPENS: Record<string, [number, number]> = { "1111.T": [2000, 1940], "2222.T": [1000, 980], "3333.T": [3000, 2985] };
  const provider: DataProvider = {
    async daily(symbol, _range, now) {
      const [prev, open] = OPENS[symbol];
      const seen = (M[symbol] ?? []).filter(([t]) => at(t) <= now);
      const low = Math.min(open, ...seen.map((b) => b[2])), close = seen.length ? seen[seen.length - 1][3] : open;
      const bars: DailyBar[] = [{ date: "2026-11-16", o: prev, h: prev, l: prev, c: prev }, { date: "2026-11-17", o: prev, h: prev, l: prev, c: prev }];
      if (now >= at("09:00")) bars.push({ date: DATE, o: open, h: Math.max(open, close), l: low, c: close });
      return bars;
    },
    async intraday(symbol, _interval, _range, now) {
      return (M[symbol] ?? []).filter(([t]) => at(t) <= now).map(([t, o, l, c]): Bar => ({ t: at(t), o, h: Math.max(o, c), l, c, v: 1000 }));
    },
  };

  it("寄りで2銘柄を買い、1銘柄は 9:10 の足で損切り、もう1銘柄は 10:00 の足の始値で売る", async () => {
    const f = fakeDb(S);
    // 9:03: 寄り値がそろったので、ギャップの大きい順に 1111（-3%）と 2222（-2%）を買う。3333（-0.5%）は見送り
    await paperTick(f.db, provider, at("09:03"));
    expect(f.state(DATE).position).toMatchObject({ symbol: "1111.T", shares: 100, entryPrice: 1940, stop: 1930 });
    expect(f.state(DATE).more).toMatchObject([{ symbol: "2222.T", shares: 200, entryPrice: 980 }]);
    // 9:12: 9:10 の足はまだ形成中かもしれないので使わない。9:05 の足では損切りに届いていない
    expect((await paperTick(f.db, provider, at("09:12"))).trades).toHaveLength(0);
    // 9:17: 9:10 の足が確定し、安値 1925 が損切り 1930 に届く → 1929 で売る
    expect((await paperTick(f.db, provider, at("09:17"))).trades).toMatchObject([{ symbol: "1111.T", exitPrice: 1929, reason: "stop_loss", pnl: -1100 }]);
    expect(f.state(DATE).position?.symbol).toBe("2222.T");
    // 10:02: 10:00 の足はまだ最後の足なので待つ。10:07 に確定して始値 990 から1ティック引いて売る
    expect((await paperTick(f.db, provider, at("10:02"))).trades).toHaveLength(0);
    expect((await paperTick(f.db, provider, at("10:07"))).trades).toMatchObject([{ symbol: "2222.T", exitPrice: 989, reason: "force_close", pnl: 1800 }]);
    const end = f.state(DATE);
    expect(end.position).toBeNull();
    expect(end.more).toBeUndefined();
    expect(end.tradeCount).toBe(2);
    expect(end.realizedPnl).toBe(700);
    expect(f.trades).toHaveLength(2);
    // そのあと動かしても買い直さない
    expect((await paperTick(f.db, provider, at("10:30"))).trades).toHaveLength(0);
    expect(f.state(DATE).position).toBeNull();
  });
});
