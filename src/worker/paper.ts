import { closePosition, finishDay, newDay, processBar } from "../core/engine";
import { gapOpenTick, jstTime, openQuote } from "../core/gapopen";
import type { OpenQuote } from "../core/gapopen";
import { SESSION_CLOSE, inSession, jstDate, jstMinutes } from "../core/market";
import { DEFAULT_SETTINGS, parseSettings } from "../core/types";
import type { Bar, DayState, Settings, Trade } from "../core/types";
import type { DataProvider } from "../data/provider";

export async function getSettings(db: D1Database): Promise<Settings> {
  const row = await db.prepare("SELECT json FROM settings WHERE id = 1").first<{ json: string }>();
  return row ? parseSettings(JSON.parse(row.json)) : DEFAULT_SETTINGS;
}

export async function saveSettings(db: D1Database, settings: Settings): Promise<void> {
  await db
    .prepare(
      "INSERT INTO settings (id, json, updated_at) VALUES (1, ?1, ?2) ON CONFLICT (id) DO UPDATE SET json = ?1, updated_at = ?2",
    )
    .bind(JSON.stringify(settings), new Date().toISOString())
    .run();
}

export async function getDay(db: D1Database, date: string): Promise<DayState | null> {
  const row = await db.prepare("SELECT state_json FROM days WHERE date = ?").bind(date).first<{ state_json: string }>();
  return row ? (JSON.parse(row.state_json) as DayState) : null;
}

function saveStatements(db: D1Database, state: DayState, trades: Trade[]): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO days (date, realized_pnl, trade_count, halted, state_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (date) DO UPDATE SET realized_pnl = ?2, trade_count = ?3, halted = ?4, state_json = ?5, updated_at = ?6`,
      )
      .bind(state.date, state.realizedPnl, state.tradeCount, state.halted, JSON.stringify(state), new Date().toISOString()),
    ...trades.map((t) =>
      db
        .prepare(
          `INSERT INTO trades (date, symbol, side, shares, entry_t, entry_price, exit_t, exit_price, pnl, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(t.date, t.symbol, t.side, t.shares, t.entryT, t.entryPrice, t.exitT, t.exitPrice, t.pnl, t.reason),
    ),
  ];
}

export interface TickResult {
  date: string;
  skipped?: "disabled";
  processedBars: number;
  trades: Trade[];
  errors: string[];
}

/**
 * ペーパートレードの1回分。新しく確定した1分足をエンジンに流し、結果をD1に保存する。
 * 何度呼んでも同じ足を二重に処理しない。
 */
export async function paperTick(db: D1Database, provider: DataProvider, now: number): Promise<TickResult> {
  const date = jstDate(now);
  const settings = await getSettings(db);
  if (!settings.enabled) return { date, skipped: "disabled", processedBars: 0, trades: [], errors: [] };

  if (settings.strategy === "gapopen") return gapOpenPaperTick(db, provider, settings, now);

  const statements: D1PreparedStatement[] = [];
  let state = await getDay(db, date);
  if (!state) {
    // 前営業日のポジションが残っていたら、最後の足の終値で決済しておく
    const prev = await db
      .prepare("SELECT state_json FROM days WHERE date < ? ORDER BY date DESC LIMIT 1")
      .bind(date)
      .first<{ state_json: string }>();
    state = newDay(date);
    if (prev) {
      const prevState = JSON.parse(prev.state_json) as DayState;
      if (prevState.position || prevState.pending) {
        const closed = finishDay(prevState, settings);
        statements.push(...saveStatements(db, prevState, closed));
      }
      // ギャップを見る戦略のために、前営業日の最後の足の終値を引き継ぐ
      const closes = Object.entries(prevState.bars ?? {}).flatMap(([sym, bars]) => (bars.length ? [[sym, bars[bars.length - 1].c] as const] : []));
      if (closes.length) state.prevClose = Object.fromEntries(closes);
    }
  }

  // 大引けから30分以上たてば、遅延データでも最後の足まで確定している
  const dayComplete = jstMinutes(now) >= SESSION_CLOSE + 30;
  const queue: { symbol: string; bar: Bar }[] = [];
  const errors: string[] = [];
  for (const symbol of settings.symbols) {
    try {
      const bars = (await provider.intraday(symbol, "1m", "1d", now)).filter(
        (b) => jstDate(b.t) === date && inSession(b.t),
      );
      // 最後の足はまだ形成中の可能性があるので、次の足が出るまで処理しない
      const confirmed = dayComplete ? bars : bars.slice(0, -1);
      const lastT = state.bars[symbol]?.at(-1)?.t ?? 0;
      for (const bar of confirmed) if (bar.t > lastT) queue.push({ symbol, bar });
    } catch (e) {
      errors.push(`${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  queue.sort((a, b) => a.bar.t - b.bar.t);

  const trades: Trade[] = [];
  for (const { symbol, bar } of queue) trades.push(...processBar(state, settings, symbol, bar));
  if (dayComplete) trades.push(...finishDay(state, settings));

  if (queue.length > 0 || trades.length > 0) statements.push(...saveStatements(db, state, trades));
  if (statements.length > 0) await db.batch(statements);
  return { date, processedBars: queue.length, trades, errors };
}

/**
 * 安寄り買いのペーパートレード。寄り付きと大引けの値が分足にないので、日足（取引中の当日の足を含む）で動かす。
 * 寄り付いた銘柄から順に入るかどうかを決め、保有中は安値で損切りを、大引け後は終値での決済を判定する。
 */
async function gapOpenPaperTick(db: D1Database, provider: DataProvider, settings: Settings, now: number): Promise<TickResult> {
  const date = jstDate(now);
  const statements: D1PreparedStatement[] = [];
  const errors: string[] = [];
  let state = await getDay(db, date);
  if (!state) {
    state = newDay(date);
    // 前営業日のポジションが残っていたら（大引け後の処理が動かなかった場合）、その日の日足で決済する
    const prev = await db
      .prepare("SELECT state_json FROM days WHERE date < ? ORDER BY date DESC LIMIT 1")
      .bind(date)
      .first<{ state_json: string }>();
    const prevState = prev ? (JSON.parse(prev.state_json) as DayState) : null;
    const pos = prevState?.position;
    if (prevState && pos) {
      try {
        const bar = (await provider.daily(pos.symbol, "1mo", now)).find((b) => b.date === prevState.date);
        if (!bar) throw new Error(`${prevState.date} の日足がありません`);
        const stopped = bar.l <= pos.stop;
        const closed = closePosition(prevState, settings, jstTime(prevState.date, SESSION_CLOSE), stopped ? pos.stop : bar.c, stopped ? "stop_loss" : "eod");
        statements.push(...saveStatements(db, prevState, [closed]));
      } catch (e) {
        errors.push(`${pos.symbol}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // 大引けから30分以上たてば、遅延データでも終値が確定している
  const dayComplete = jstMinutes(now) >= SESSION_CLOSE + 30;
  const decided = state.decided ?? [];
  const wanted = new Set(settings.symbols.filter((sym) => !decided.includes(sym)));
  if (state.position) wanted.add(state.position.symbol);
  const quotes: Record<string, OpenQuote> = {};
  for (const symbol of wanted) {
    try {
      const bars = await provider.daily(symbol, "5d", now);
      const i = bars.findIndex((b) => b.date === date);
      const q = i >= 1 ? openQuote(bars, i) : null;
      if (q) quotes[symbol] = q;
    } catch (e) {
      errors.push(`${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const before = decided.length;
  const hadPosition = state.position != null;
  const trades = gapOpenTick(state, settings, quotes, now, dayComplete);
  const changed = trades.length > 0 || (state.decided?.length ?? 0) !== before || (state.position != null) !== hadPosition;
  if (changed) statements.push(...saveStatements(db, state, trades));
  if (statements.length > 0) await db.batch(statements);
  return { date, processedBars: Object.keys(quotes).length, trades, errors };
}
