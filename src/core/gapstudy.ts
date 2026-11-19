/**
 * ギャップ埋め（安く寄った日に買い、前日終値への戻りを狙う）を日足で近似して検証する。
 * 分足は直近60日しか取れないので、長い期間で標本を増やすために使う。
 */
import { tickSize } from "./market";

/** 1日分の日足。dividend はその日が権利落ち日のときの1株あたり配当 */
export interface DailyBar {
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
  dividend?: number;
}

export type GapExit = "target" | "stop" | "close";

export interface GapTrade {
  symbol: string;
  date: string;
  /** 前日終値から始値へのギャップ（%、マイナス） */
  gapPct: number;
  /** 滑り込みの損益率 */
  ret: number;
  exit: GapExit;
}

export interface GapOptions {
  /** この%以上安く寄った日に入る */
  minGapPct: number;
  /** 成行（新規・損切り・引け決済）に加える不利なティック数 */
  slippageTicks: number;
  /** false なら利確も損切りも置かず、引けまで持つ */
  useStops: boolean;
  /** これ以上のギャップ（%）はデータの誤りや未調整の分割とみなして除く */
  maxGapPct?: number;
}

/**
 * 始値で買い、利確は前日終値、損切りは同じ幅だけ下、どちらにも届かなければ終値で決済する。
 * 日足では高値と安値のどちらが先か分からないので、両方に届いた日は損切りとして数える。
 * 権利落ち日は、配当の分だけ前日終値を下げてからギャップを測る。
 */
export function gapFadeDaily(symbol: string, bars: DailyBar[], opt: GapOptions): GapTrade[] {
  const trades: GapTrade[] = [];
  const maxGap = opt.maxGapPct ?? 25;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const prevClose = bars[i - 1].c - (b.dividend ?? 0);
    if (!(prevClose > 0) || !(b.o > 0) || b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c)) continue;
    const gapPct = ((b.o - prevClose) / prevClose) * 100;
    if (gapPct > -opt.minGapPct || gapPct < -maxGap) continue;
    const slip = opt.slippageTicks * tickSize(b.o, true);
    const entry = b.o + slip;
    const stop = b.o - (prevClose - b.o);
    let exitPrice = b.c - slip;
    let exit: GapExit = "close";
    if (opt.useStops) {
      if (b.l <= stop) {
        exitPrice = stop - slip;
        exit = "stop";
      } else if (b.h >= prevClose) {
        exitPrice = prevClose;
        exit = "target";
      }
    }
    trades.push({ symbol, date: b.date, gapPct, ret: (exitPrice - entry) / entry, exit });
  }
  return trades;
}

export interface GapSummary {
  trades: number;
  /** 取引のあった日数 */
  days: number;
  winRate: number | null;
  profitFactor: number | null;
  /** 1取引あたりの平均損益率（bp） */
  avgBp: number | null;
  /** 日ごとに平均してから日数で平均した損益率（bp）。同じ日の取引は連動するので、こちらが実質の標本 */
  avgDayBp: number | null;
  /** 日ごとの平均の t 値。2 を超えると偶然では説明しにくい */
  tStat: number | null;
  /** 日ごとの平均がプラスだった日の割合 */
  winDayRate: number | null;
}

export function summarize(trades: GapTrade[]): GapSummary {
  const byDay = new Map<string, number[]>();
  for (const t of trades) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t.ret]);
  const dayMeans = [...byDay.values()].map((r) => r.reduce((a, x) => a + x, 0) / r.length);
  const n = dayMeans.length;
  const mean = n ? dayMeans.reduce((a, x) => a + x, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(dayMeans.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const win = trades.filter((t) => t.ret > 0).reduce((a, t) => a + t.ret, 0);
  const loss = trades.filter((t) => t.ret < 0).reduce((a, t) => a - t.ret, 0);
  return {
    trades: trades.length,
    days: n,
    winRate: trades.length ? trades.filter((t) => t.ret > 0).length / trades.length : null,
    profitFactor: loss > 0 ? win / loss : null,
    avgBp: trades.length ? (trades.reduce((a, t) => a + t.ret, 0) / trades.length) * 1e4 : null,
    avgDayBp: n ? mean * 1e4 : null,
    tStat: sd > 0 ? mean / (sd / Math.sqrt(n)) : null,
    winDayRate: n ? dayMeans.filter((x) => x > 0).length / n : null,
  };
}
