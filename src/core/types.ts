/** 1本の足。t は足の開始時刻（UNIX秒）。 */
import type { OpenQuote } from "./gapopen";

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Side = "long" | "short";
export const STRATEGY_NAMES = ["orb", "vwap", "momentum", "gapfade", "pullback", "gapopen", "overnight", "gapopen_overnight"] as const;
export type StrategyName = (typeof STRATEGY_NAMES)[number];
export type EntryOrder = "market" | "limit";
export type HaltReason = "target" | "loss_limit" | "max_trades";
export type ExitReason = "take_profit" | "stop_loss" | "force_close" | "eod" | "next_open";

export interface Settings {
  /** ペーパートレードの稼働フラグ */
  enabled: boolean;
  symbols: string[];
  /** TOPIX500 構成銘柄など、細かい呼値（3,000円以下で0.5円刻みなど）で取引される銘柄 */
  fineTickSymbols: string[];
  strategy: StrategyName;
  shares: number;
  /** この金額以上の確定益でその日の新規発注を止める。0 なら利益の上限なし */
  dailyTargetYen: number;
  /** この金額以上の確定損でその日の新規発注を止める。損切り幅もこの枠に収まるよう狭める */
  dailyLossLimitYen: number;
  maxTradesPerDay: number;
  /** 成行（新規・損切り・強制決済）に不利方向へ加えるティック数 */
  slippageTicks: number;
  commissionPerOrderYen: number;
  /** 新規の出し方。market は次の足の始値で成行、limit はシグナルが出た足の終値に指値を置く */
  entryOrder: EntryOrder;
  /** 指値が約定しないまま何本の足で取り消すか */
  limitWaitBars: number;
  allowShort: boolean;
  /** "HH:MM"（JST）。これ以降は新規発注しない */
  noEntryAfter: string;
  /** "HH:MM"（JST）。これ以降の足の始値で強制決済する */
  forceCloseAt: string;
  /** ORB: 寄り付きから何分をレンジとするか */
  orbMinutes: number;
  /** ORB: 損切り幅に対する利確幅の倍率 */
  orbRewardRisk: number;
  /** VWAP: 乖離が標準偏差の何倍で逆張りするか */
  vwapK: number;
  /** VWAP: 判定に必要な最小の足数 */
  vwapMinBars: number;
  /** 後場順張り: 前場の騰落率（%）がこれ以上のときだけ入る */
  momMinPct: number;
  /** ギャップ埋め: 前日終値からのギャップ（%）がこれ以上のときだけ入る */
  gapMinPct: number;
  /** 安寄り買い: 寄り付きの値からこの%下げたら損切りする */
  gapStopPct: number;
  /** 安寄り買い: 1回の買付金額（株価×株数）がこれを超える銘柄は見送る。0 なら上限なし */
  maxPositionYen: number;
  /** 安寄り買い: 前日の終値が前々日よりこの%以上下げていた銘柄だけを買う（2日続けての下げ）。0 なら見ない */
  gapPrevDropPct: number;
  /** 持ち越し: 場中（始値から終値）の上げがこの%以上の銘柄を大引けで買う */
  overnightMinPct: number;
  /** 持ち越し: 1回の買付金額の上限。損切りを置けないので小さめにする。0 なら maxPositionYen と同じ */
  overnightMaxPositionYen: number;
  /** 持ち越し: 1回の株数（ETF は口数）。0 なら shares と同じ */
  overnightShares: number;
  /** 持ち越し: 大引けで買う曜日（1 = 月曜 … 5 = 金曜）。空ならどの曜日でも買う */
  overnightWeekdays: number[];
  /** 持ち越し: 米国の株式市場が休みの日（その夜に米国市場が開かない日）の大引けでは買わない */
  overnightSkipUsHolidays: boolean;
  /** 持ち越し: 対象銘柄（ETF など）。空なら symbols と同じ。ここだけにある銘柄は安寄り買いの対象にしない */
  overnightSymbols: string[];
}

/**
 * 対象銘柄の上限。日足で動かす戦略（安寄り買い、持ち越し）は、株価を1回の定期実行で少しずつ順に取りにいくので多くてよい。
 * 分足で動かす戦略は毎分すべての銘柄を取りにいくので、MAX_INTRADAY_SYMBOLS まで。
 */
export const MAX_SYMBOLS = 300;
export const MAX_INTRADAY_SYMBOLS = 20;
const DAILY_STRATEGIES: readonly StrategyName[] = ["gapopen", "overnight", "gapopen_overnight"];

export const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  symbols: ["7203.T"],
  fineTickSymbols: ["7203.T"],
  strategy: "orb",
  shares: 100,
  dailyTargetYen: 0,
  dailyLossLimitYen: 1000,
  maxTradesPerDay: 3,
  slippageTicks: 1,
  commissionPerOrderYen: 0,
  entryOrder: "market",
  limitWaitBars: 3,
  allowShort: false,
  noEntryAfter: "14:30",
  forceCloseAt: "15:20",
  orbMinutes: 15,
  orbRewardRisk: 1,
  vwapK: 2,
  vwapMinBars: 12,
  momMinPct: 0.5,
  gapMinPct: 1,
  gapStopPct: 0.5,
  maxPositionYen: 0,
  overnightMinPct: 2,
  overnightMaxPositionYen: 0,
  gapPrevDropPct: 0,
  overnightShares: 0,
  overnightWeekdays: [],
  overnightSymbols: [],
  overnightSkipUsHolidays: false,
};

export interface Signal {
  side: Side;
  stop: number;
  target: number;
}

export interface Position {
  symbol: string;
  side: Side;
  shares: number;
  entryT: number;
  entryPrice: number;
  stop: number;
  target: number;
  /** 大引けで買って翌朝の寄り付きで売る持ち越しのポジションか */
  overnight?: boolean;
}

export interface Trade {
  date: string;
  symbol: string;
  side: Side;
  shares: number;
  entryT: number;
  entryPrice: number;
  exitT: number;
  exitPrice: number;
  pnl: number;
  reason: ExitReason;
}

export interface DayState {
  date: string;
  realizedPnl: number;
  tradeCount: number;
  halted: HaltReason | null;
  position: Position | null;
  /** 次の足の始値で約定させる注文 */
  pending: (Signal & { symbol: string; limit?: { price: number; barsLeft: number } }) | null;
  bars: Record<string, Bar[]>;
  /** 銘柄ごとの前営業日の終値（ギャップを見る戦略が使う） */
  prevClose?: Record<string, number>;
  /** 安寄り買いで、その日の寄り付きを見て入るかどうかを決め終えた銘柄 */
  decided?: string[];
  /** 持ち越しで、その日の大引けに買うかどうかを決め終えたか */
  overnightDecided?: boolean;
  /** 安寄り買い: 寄り値を取り終えたが、まだ入るかどうかを判断していない銘柄の値 */
  gathered?: Record<string, OpenQuote>;
  /** 安寄り買い: 次にどの銘柄から株価を取りにいくか */
  fetchCursor?: number;
}

function isHHMM(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** 外部入力を既定値にマージし、範囲外の値はエラーにする。 */
export function parseSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  if (typeof input !== "object" || input === null) throw new Error("settings must be an object");
  const src = input as Record<string, unknown>;
  const out: Settings = { ...base };
  const num = (key: keyof Settings, min: number, max: number, integer = false) => {
    if (!(key in src)) return;
    const v = src[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      throw new Error(`${key} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`);
    }
    (out[key] as number) = v;
  };
  const bool = (key: keyof Settings) => {
    if (!(key in src)) return;
    if (typeof src[key] !== "boolean") throw new Error(`${key} must be a boolean`);
    (out[key] as boolean) = src[key] as boolean;
  };
  const time = (key: "noEntryAfter" | "forceCloseAt") => {
    if (!(key in src)) return;
    if (!isHHMM(src[key])) throw new Error(`${key} must be "HH:MM"`);
    out[key] = src[key] as string;
  };

  bool("enabled");
  bool("allowShort");
  bool("overnightSkipUsHolidays");
  num("shares", 1, 100000, true);
  num("dailyTargetYen", 0, 1e7);
  num("dailyLossLimitYen", 1, 1e7);
  num("maxTradesPerDay", 1, 100, true);
  num("slippageTicks", 0, 20, true);
  num("commissionPerOrderYen", 0, 1e5);
  num("limitWaitBars", 1, 100, true);
  num("orbMinutes", 5, 120, true);
  num("orbRewardRisk", 0.1, 10);
  num("vwapK", 0.5, 5);
  num("vwapMinBars", 5, 200, true);
  num("momMinPct", 0, 20);
  num("gapMinPct", 0.1, 20);
  num("gapStopPct", 0.1, 10);
  num("maxPositionYen", 0, 1e9);
  num("gapPrevDropPct", 0, 20);
  num("overnightMinPct", -100, 20);
  num("overnightMaxPositionYen", 0, 1e9);
  num("overnightShares", 0, 100000, true);
  time("noEntryAfter");
  time("forceCloseAt");
  if ("strategy" in src) {
    if (!STRATEGY_NAMES.includes(src.strategy as StrategyName)) throw new Error(`strategy must be one of ${STRATEGY_NAMES.join(", ")}`);
    out.strategy = src.strategy as StrategyName;
  }
  if ("entryOrder" in src) {
    if (src.entryOrder !== "market" && src.entryOrder !== "limit") throw new Error('entryOrder must be "market" or "limit"');
    out.entryOrder = src.entryOrder;
  }
  if ("symbols" in src) {
    const v = src.symbols;
    if (!Array.isArray(v) || v.length < 1 || v.length > MAX_SYMBOLS || !v.every((s) => typeof s === "string")) {
      throw new Error(`symbols must be an array of 1-${MAX_SYMBOLS} strings`);
    }
    out.symbols = (v as string[]).map(normalizeSymbol);
  }
  if ("overnightSymbols" in src) {
    const v = src.overnightSymbols;
    if (!Array.isArray(v) || v.length > MAX_INTRADAY_SYMBOLS || !v.every((s) => typeof s === "string")) {
      throw new Error(`overnightSymbols must be an array of up to ${MAX_INTRADAY_SYMBOLS} strings`);
    }
    out.overnightSymbols = (v as string[]).map(normalizeSymbol);
  }
  if ("overnightWeekdays" in src) {
    const v = src.overnightWeekdays;
    if (!Array.isArray(v) || !v.every((d) => Number.isInteger(d) && d >= 1 && d <= 5)) throw new Error("overnightWeekdays must be an array of 1-5 (Mon-Fri)");
    out.overnightWeekdays = [...new Set(v as number[])].sort();
  }
  if ("fineTickSymbols" in src) {
    const v = src.fineTickSymbols;
    if (!Array.isArray(v) || v.length > 500 || !v.every((s) => typeof s === "string")) {
      throw new Error("fineTickSymbols must be an array of strings");
    }
    out.fineTickSymbols = (v as string[]).map(normalizeSymbol);
  }
  if (!DAILY_STRATEGIES.includes(out.strategy) && out.symbols.length > MAX_INTRADAY_SYMBOLS) {
    throw new Error(`strategy ${out.strategy} supports up to ${MAX_INTRADAY_SYMBOLS} symbols (gapopen, overnight and gapopen_overnight support ${MAX_SYMBOLS})`);
  }
  return out;
}

/** "7203" → "7203.T" */
export function normalizeSymbol(s: string): string {
  const t = s.trim().toUpperCase();
  if (!/^[0-9A-Z]{4}(\.T)?$/.test(t)) throw new Error(`invalid symbol: ${s}`);
  return t.endsWith(".T") ? t : `${t}.T`;
}
