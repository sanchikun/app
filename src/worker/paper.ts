import { finishDay, newDay, processBar } from "../core/engine";
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

  const statements: D1PreparedStatement[] = [];
  let state = await getDay(db, date);
  if (!state) {
    // 前営業日のポジションが残っていたら、最後の足の終値で決済しておく
    const prev = await db
      .prepare("SELECT state_json FROM days WHERE date < ? ORDER BY date DESC LIMIT 1")
      .bind(date)
      .first<{ state_json: string }>();
    if (prev) {
      const prevState = JSON.parse(prev.state_json) as DayState;
      if (prevState.position || prevState.pending) {
        const closed = finishDay(prevState, settings);
        statements.push(...saveStatements(db, prevState, closed));
      }
    }
    state = newDay(date);
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
