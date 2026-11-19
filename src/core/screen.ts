/**
 * 銘柄選びの検証用。寄り付きレンジが確定した時点で分かる指標を日ごとに出し、
 * その日の損益と突き合わせて「どの指標に選別力があるか」を集計する。
 */
import { SESSION_OPEN, groupByDate, jstMinutes, tickSize } from "./market";
import type { Bar, Settings } from "./types";

/** 寄り付きレンジ確定時点までの情報だけで計算した、その日の指標 */
export interface DayFeatures {
  date: string;
  /** 前日終値から当日始値へのギャップの大きさ（%、絶対値） */
  gapPct: number | null;
  /** 寄り付きレンジの出来高 ÷ 直近の平均（同じ時間帯） */
  orVolRatio: number | null;
  /** 寄り付きレンジの値幅 ÷ 始値（%） */
  orRangePct: number;
  /** 寄り付きレンジの値幅 ÷ 直近の平均 */
  orRangeRatio: number | null;
  /** 直近の日中値幅（高値−安値）÷ 終値 の平均（%） */
  prevRangePct: number | null;
  /** 寄り付きレンジの値幅が何ティック分か。小さいほど滑り1ティックの負担が重い */
  orRangeTicks: number;
  /** 戦略が求める損切り幅（レンジの半分）÷ 損失枠で許される損切り幅。1 を超えると損切りが狭められる */
  stopFit: number;
  /** 寄り付きレンジの売買代金（円） */
  orTurnover: number;
}

export const FEATURE_KEYS = ["gapPct", "orVolRatio", "orRangePct", "orRangeRatio", "prevRangePct", "orRangeTicks", "stopFit", "orTurnover"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  gapPct: "ギャップ(%)",
  orVolRatio: "レンジ出来高比",
  orRangePct: "レンジ値幅(%)",
  orRangeRatio: "レンジ値幅比",
  prevRangePct: "直近の日中値幅(%)",
  orRangeTicks: "レンジ値幅(ティック)",
  stopFit: "損切り幅÷損失枠",
  orTurnover: "レンジ売買代金",
};

const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

/**
 * 足を日ごとに分け、各日の指標を返す。比率の指標は直近 lookback 日の平均と比べ、
 * 過去が minHistory 日に満たない日は null にする。当日のレンジ確定後の足は使わない。
 */
export function dayFeatures(bars: Bar[], s: Settings, fine: boolean, lookback = 10, minHistory = 5): DayFeatures[] {
  const rangeEnd = SESSION_OPEN + s.orbMinutes;
  const out: DayFeatures[] = [];
  const history: { orVol: number; orRange: number; dayRangePct: number; close: number }[] = [];

  for (const [date, day] of groupByDate(bars)) {
    const or = day.filter((b) => jstMinutes(b.t) < rangeEnd);
    const dayHi = Math.max(...day.map((b) => b.h));
    const dayLo = Math.min(...day.map((b) => b.l));
    const close = day[day.length - 1].c;
    if (or.length === 0) {
      // 寄り付きの足がない日（データ欠け）は指標を出さず、翌日以降の比較にも使わない
      continue;
    }
    const open = or[0].o;
    const orRange = Math.max(...or.map((b) => b.h)) - Math.min(...or.map((b) => b.l));
    const orVol = or.reduce((a, b) => a + b.v, 0);
    const past = history.slice(-lookback);
    const enough = past.length >= minHistory;
    const prev = history[history.length - 1];
    const avgVol = enough ? mean(past.map((h) => h.orVol)) : 0;
    const avgRange = enough ? mean(past.map((h) => h.orRange)) : 0;
    const tick = tickSize(open, fine);

    out.push({
      date,
      gapPct: prev ? (Math.abs(open - prev.close) / prev.close) * 100 : null,
      orVolRatio: avgVol > 0 ? orVol / avgVol : null,
      orRangePct: (orRange / open) * 100,
      orRangeRatio: avgRange > 0 ? orRange / avgRange : null,
      prevRangePct: enough ? mean(past.map((h) => h.dayRangePct)) : null,
      orRangeTicks: orRange / tick,
      stopFit: Math.max(orRange / 2, 2 * tick) / (s.dailyLossLimitYen / s.shares),
      orTurnover: or.reduce((a, b) => a + ((b.h + b.l + b.c) / 3) * b.v, 0),
    });
    history.push({ orVol, orRange, dayRangePct: ((dayHi - dayLo) / close) * 100, close });
  }
  return out;
}

/** 1銘柄・1日分の観測。指標と、その日の取引ごとの損益 */
export interface Observation {
  symbol: string;
  date: string;
  features: DayFeatures;
  tradePnls: number[];
  /** 取引ごとの損益率（損益 ÷ 建玉の金額）。株価の違う銘柄をまとめて見るために使う */
  tradeRets: number[];
}

export interface BucketStats {
  label: string;
  /** 銘柄×日の数 */
  days: number;
  trades: number;
  pnl: number;
  pnlPerDay: number;
  winRate: number | null;
  profitFactor: number | null;
  /** 1取引あたりの平均損益率（bp = 0.01%） */
  avgRetBp: number | null;
}

export function stats(label: string, obs: Observation[]): BucketStats {
  const pnls = obs.flatMap((o) => o.tradePnls);
  const rets = obs.flatMap((o) => o.tradeRets);
  const pnl = pnls.reduce((a, p) => a + p, 0);
  const win = pnls.filter((p) => p > 0).reduce((a, p) => a + p, 0);
  const loss = pnls.filter((p) => p < 0).reduce((a, p) => a - p, 0);
  return {
    label,
    days: obs.length,
    trades: pnls.length,
    pnl,
    pnlPerDay: obs.length ? pnl / obs.length : 0,
    winRate: pnls.length ? pnls.filter((p) => p > 0).length / pnls.length : null,
    profitFactor: loss > 0 ? win / loss : null,
    avgRetBp: rets.length ? (rets.reduce((a, r) => a + r, 0) / rets.length) * 1e4 : null,
  };
}

/** 値を3等分する2つの境界（下位1/3と上位1/3の境目） */
export function tercileCuts(values: number[]): [number, number] | null {
  const v = [...values].sort((a, b) => a - b);
  if (v.length < 3) return null;
  return [v[Math.floor(v.length / 3)], v[Math.floor((v.length * 2) / 3)]];
}

/** 指標の値で観測を 低・中・高 に分けて集計する。指標が null の観測は除く */
export function bucketByFeature(obs: Observation[], key: FeatureKey, cuts: [number, number]): BucketStats[] {
  const groups: Observation[][] = [[], [], []];
  for (const o of obs) {
    const v = o.features[key];
    if (v == null) continue;
    groups[v < cuts[0] ? 0 : v < cuts[1] ? 1 : 2].push(o);
  }
  return ["低", "中", "高"].map((label, i) => stats(label, groups[i]));
}
