import { cleanPrice, jstDate, roundToTick } from "../core/market";
import type { DailyBar } from "../core/gapstudy";
import type { Bar } from "../core/types";

export type Interval = "1m" | "5m" | "15m";
export const INTERVAL_SECONDS: Record<Interval, number> = { "1m": 60, "5m": 300, "15m": 900 };

/** Yahoo Finance が受け付ける期間。1分足は直近7日、5分足・15分足は直近60日まで。 */
export const RANGES = ["1d", "5d", "7d", "1mo", "60d"] as const;
export type Range = (typeof RANGES)[number];

export interface DataProvider {
  /** now（UNIX秒）時点で取得できる足を時刻順に返す */
  intraday(symbol: string, interval: Interval, range: Range, now: number): Promise<Bar[]>;
  /** 日足を日付順に返す。取引中の当日の足（ここまでの始値・高値・安値・現在値）も含む */
  daily(symbol: string, range: string, now: number): Promise<DailyBar[]>;
}

interface YahooChart {
  chart: {
    result?: {
      timestamp?: number[];
      indicators: { quote: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
    }[];
    error?: { description?: string } | null;
  };
}

export function parseYahooChart(json: YahooChart): Bar[] {
  const result = json.chart.result?.[0];
  if (!result) throw new Error(json.chart.error?.description ?? "no chart data");
  const ts = result.timestamp ?? [];
  const q = result.indicators.quote[0] ?? {};
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    // 取引のなかった足は null で返ってくる
    if (o == null || h == null || l == null || c == null) continue;
    // 値は単精度で返ってくる（162.4 が 162.39999389648438 になる）ので、0.1円刻みに戻す
    bars.push({ t: ts[i], o: cleanPrice(o), h: cleanPrice(h), l: cleanPrice(l), c: cleanPrice(c), v: q.volume?.[i] ?? 0 });
  }
  return bars;
}

/**
 * Yahoo Finance の非公式チャートAPI。東証の値は約20分遅れで、予告なく仕様変更や
 * アクセス制限がありうる。検証用であり、実弾の発注判断には使わないこと。
 */
export const yahoo: DataProvider = {
  async intraday(symbol, interval, range) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!res.ok) throw new Error(`yahoo ${symbol}: HTTP ${res.status}`);
    const step = INTERVAL_SECONDS[interval];
    // 末尾に付く「現在値」の足（時刻が足の境界に乗らない）を除く
    return parseYahooChart(await res.json()).filter((b) => b.t % step === 0);
  },
  daily: (symbol, range) => yahooDaily(symbol, range),
};

interface YahooDailyChart {
  chart: {
    result?: {
      timestamp?: number[];
      indicators: { quote: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
      events?: { dividends?: Record<string, { amount: number; date: number }> };
    }[];
    error?: { description?: string } | null;
  };
}

/** 日足と権利落ち日の配当。値は株式分割の調整済みで、呼値の刻みには乗らないことがある */
export function parseYahooDaily(json: YahooDailyChart): DailyBar[] {
  const result = json.chart.result?.[0];
  if (!result) throw new Error(json.chart.error?.description ?? "no chart data");
  const ts = result.timestamp ?? [];
  const q = result.indicators.quote[0] ?? {};
  const dividends = new Map(Object.values(result.events?.dividends ?? {}).map((d) => [jstDate(d.date), d.amount]));
  const bars: DailyBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    const date = jstDate(ts[i]);
    const dividend = dividends.get(date);
    const v = q.volume?.[i];
    bars.push({ date, o, h, l, c, ...(v != null ? { v } : {}), ...(dividend ? { dividend } : {}) });
  }
  return bars;
}

/** Yahoo Finance の日足。range は "1y" "5y" "10y" など */
export async function yahooDaily(symbol: string, range: string): Promise<DailyBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}&events=div`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!res.ok) throw new Error(`yahoo ${symbol}: HTTP ${res.status}`);
  return parseYahooDaily(await res.json());
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const RANGE_DAYS: Record<Range, number> = { "1d": 1, "5d": 5, "7d": 7, "1mo": 22, "60d": 60 };

/**
 * 開発・テスト用の合成データ（ランダムウォーク）。日付と銘柄から決まる値を返すので、
 * 何度呼んでも同じ足になる。現実の値動きではないので、損益の数字に意味はない。
 */
export const synthetic: DataProvider = {
  async intraday(symbol, interval, range, now) {
    const step = INTERVAL_SECONDS[interval];
    const bars: Bar[] = [];
    const todayStart = Math.floor((now + 9 * 3600) / 86400) * 86400 - 9 * 3600;
    let found = 0;
    for (let back = 0; found < RANGE_DAYS[range] && back < 120; back++) {
      const dayStart = todayStart - back * 86400;
      const weekday = new Date((dayStart + 9 * 3600) * 1000).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      found++;
      const rand = mulberry32(hash(`${symbol}:${jstDate(dayStart)}`));
      let price = 1500 + Math.floor(rand() * 1000);
      const drift = (rand() - 0.5) * 0.6;
      const day: Bar[] = [];
      for (const [from, to] of [[9 * 3600, 11.5 * 3600], [12.5 * 3600, 15.5 * 3600]]) {
        for (let sec = from; sec < to; sec += step) {
          const t = dayStart + sec;
          if (t + step > now) break;
          const o = price;
          const scale = Math.sqrt(step / 60) * 1.5;
          const c = roundToTick(Math.max(100, o + drift * (step / 60) + (rand() - 0.5) * 2 * scale));
          const h = Math.max(o, c) + Math.floor(rand() * 2 * scale);
          const l = Math.min(o, c) - Math.floor(rand() * 2 * scale);
          day.push({ t, o, h, l, c, v: 1000 + Math.floor(rand() * 20000) });
          price = c;
        }
      }
      bars.unshift(...day);
    }
    return bars;
  },
  daily: async () => [],
};

/** 分足を日ごとにまとめて日足にする */
export function toDaily(bars: Bar[]): DailyBar[] {
  const days = new Map<string, DailyBar>();
  for (const b of bars) {
    const date = jstDate(b.t);
    const d = days.get(date);
    if (!d) days.set(date, { date, o: b.o, h: b.h, l: b.l, c: b.c });
    else {
      d.h = Math.max(d.h, b.h);
      d.l = Math.min(d.l, b.l);
      d.c = b.c;
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

synthetic.daily = async (symbol, _range, now) => toDaily(await synthetic.intraday(symbol, "5m", "60d", now));

export function getProvider(name: string | undefined): DataProvider {
  return name === "synthetic" ? synthetic : yahoo;
}
