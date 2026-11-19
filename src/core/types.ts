/** 1本の足。t は足の開始時刻（UNIX秒）。 */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Side = "long" | "short";
export type StrategyName = "orb" | "vwap";
export type HaltReason = "target" | "loss_limit" | "max_trades";
export type ExitReason = "take_profit" | "stop_loss" | "force_close" | "eod";

export interface Settings {
  /** ペーパートレードの稼働フラグ */
  enabled: boolean;
  symbols: string[];
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
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  symbols: ["7203.T"],
  strategy: "orb",
  shares: 100,
  dailyTargetYen: 0,
  dailyLossLimitYen: 1000,
  maxTradesPerDay: 3,
  slippageTicks: 1,
  commissionPerOrderYen: 0,
  allowShort: false,
  noEntryAfter: "14:30",
  forceCloseAt: "15:20",
  orbMinutes: 15,
  orbRewardRisk: 1,
  vwapK: 2,
  vwapMinBars: 12,
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
  pending: (Signal & { symbol: string }) | null;
  bars: Record<string, Bar[]>;
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
  num("shares", 1, 100000, true);
  num("dailyTargetYen", 0, 1e7);
  num("dailyLossLimitYen", 1, 1e7);
  num("maxTradesPerDay", 1, 100, true);
  num("slippageTicks", 0, 20, true);
  num("commissionPerOrderYen", 0, 1e5);
  num("orbMinutes", 5, 120, true);
  num("orbRewardRisk", 0.1, 10);
  num("vwapK", 0.5, 5);
  num("vwapMinBars", 5, 200, true);
  time("noEntryAfter");
  time("forceCloseAt");
  if ("strategy" in src) {
    if (src.strategy !== "orb" && src.strategy !== "vwap") throw new Error('strategy must be "orb" or "vwap"');
    out.strategy = src.strategy;
  }
  if ("symbols" in src) {
    const v = src.symbols;
    if (!Array.isArray(v) || v.length < 1 || v.length > 5 || !v.every((s) => typeof s === "string")) {
      throw new Error("symbols must be an array of 1-5 strings");
    }
    out.symbols = (v as string[]).map(normalizeSymbol);
  }
  return out;
}

/** "7203" → "7203.T" */
export function normalizeSymbol(s: string): string {
  const t = s.trim().toUpperCase();
  if (!/^[0-9A-Z]{4}(\.T)?$/.test(t)) throw new Error(`invalid symbol: ${s}`);
  return t.endsWith(".T") ? t : `${t}.T`;
}
