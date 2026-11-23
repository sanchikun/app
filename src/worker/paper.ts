import { closePosition, finishDay, newDay, processBar } from "../core/engine";
import { closeGapPosition, dailyTick, gapPositions, usesIntradayExit, isDailyStrategy, jstTime, openQuote, overnightSymbols, runsGapOpen, runsOvernight } from "../core/gapopen";
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

  if (isDailyStrategy(settings)) return dailyPaperTick(db, provider, settings, now);

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

/** 1回の定期実行で株価を取りにいく銘柄数。Workers の外部リクエスト数の上限（無料プランは1回50）に収める */
const FETCH_BATCH = 15;
/** 安寄り買い: まだ1銘柄も寄り値が届いていないあいだに、様子見で取りにいく銘柄数。届き始めたら FETCH_BATCH ずつ取る */
const PROBE_BATCH = 2;
/** 安寄り買い: この時刻（JST、分）を過ぎたら、寄り値がそろっていなくても取れた銘柄で判断する。株価は約20分遅れで届く */
const GAP_DECIDE_BY = 10 * 60 + 15;
/** 安寄り買い: この時刻（JST、分）を過ぎても1銘柄も寄り付いていなければ休場とみなし、株価を取りにいく回数を減らす */
const QUIET_AFTER = 10 * 60;

/**
 * 日足で動かす戦略（安寄り買い、持ち越し）のペーパートレード。寄り付きと大引けの値が分足にないので、
 * 日足（取引中の当日の足を含む）を毎分取りにいって、寄り付きでの売買、安値での損切り、大引けでの売買を判定する。
 */
async function dailyPaperTick(db: D1Database, provider: DataProvider, settings: Settings, now: number): Promise<TickResult> {
  const date = jstDate(now);
  const statements: D1PreparedStatement[] = [];
  const errors: string[] = [];
  let state = await getDay(db, date);
  let created = false;
  if (!state) {
    state = newDay(date);
    created = true;
    const prev = await db
      .prepare("SELECT state_json FROM days WHERE date < ? ORDER BY date DESC LIMIT 1")
      .bind(date)
      .first<{ state_json: string }>();
    const prevState = prev ? (JSON.parse(prev.state_json) as DayState) : null;
    const pos = prevState?.position;
    if (prevState && pos?.overnight) {
      // 持ち越しのポジションは今日の状態に移し、今日の寄り付きで決済する（損益は決済した日に付く）
      state.position = pos;
      prevState.position = null;
      statements.push(...saveStatements(db, prevState, []));
    } else if (prevState && pos) {
      // 安寄り買いのポジションが残っていたら（大引け後の処理が動かなかった場合）、その日の日足で決済する
      const closed: Trade[] = [];
      for (const left of gapPositions(prevState)) {
        try {
          const bar = (await provider.daily(left.symbol, "1mo", now)).find((b) => b.date === prevState.date);
          if (!bar) throw new Error(`${prevState.date} の日足がありません`);
          const stopped = bar.l <= left.stop;
          closed.push(closeGapPosition(prevState, settings, left, jstTime(prevState.date, SESSION_CLOSE), stopped ? left.stop : bar.c, stopped ? "stop_loss" : "eod"));
        } catch (e) {
          errors.push(`${left.symbol}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (closed.length > 0) statements.push(...saveStatements(db, prevState, closed));
    }
  }

  // 大引けから30分以上たてば、遅延データでも終値が確定している
  const dayComplete = jstMinutes(now) >= SESSION_CLOSE + 30;
  const before = JSON.stringify(state);
  const fetched: Record<string, OpenQuote> = {};
  const fetchQuote = async (symbol: string) => {
    if (symbol in fetched) return;
    try {
      const bars = await provider.daily(symbol, "5d", now);
      const i = bars.findIndex((b) => b.date === date);
      const q = i >= 1 ? openQuote(bars, i) : null;
      if (q) fetched[symbol] = q;
    } catch (e) {
      errors.push(`${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  for (const held of [state.position, ...(state.more ?? [])]) if (held) await fetchQuote(held.symbol);
  if (runsOvernight(settings) && dayComplete && !state.overnightDecided) for (const sym of overnightSymbols(settings).slice(0, FETCH_BATCH)) await fetchQuote(sym);

  // 安寄り買い: 寄り値をまだ取れていない銘柄を、1回に FETCH_BATCH ずつ順に取りにいく。全銘柄がそろう（または
  // GAP_DECIDE_BY を過ぎる）まで判断を待つので、何回に分けて取っても「ギャップが最も大きい1銘柄」を選べる
  let ready = true;
  if (runsGapOpen(settings)) {
    const decided = state.decided ?? [];
    const gathered = (state.gathered ??= {});
    const waiting = () => settings.symbols.filter((sym) => !decided.includes(sym) && !(sym in gathered));
    const pool = waiting();
    // 株価は遅れて届くので、寄り付き後しばらくは何も取れない。1銘柄も届いていないあいだは少しだけ様子を見て、
    // 届き始めてからまとめて取りにいく（1回の実行で使える CPU 時間に上限があり、取りにいく数だけ時間を使うため）。
    // 祝日は1銘柄も寄り付かないので、QUIET_AFTER を過ぎたら1回に1銘柄だけにする
    const nothingYet = decided.length === 0 && Object.keys(gathered).length === 0;
    const batch = !nothingYet ? FETCH_BATCH : jstMinutes(now) >= QUIET_AFTER ? 1 : PROBE_BATCH;
    const start = pool.length > batch ? (state.fetchCursor ?? 0) % pool.length : 0;
    for (const sym of [...pool.slice(start), ...pool.slice(0, start)].slice(0, batch)) await fetchQuote(sym);
    if (pool.length > batch) state.fetchCursor = start + batch;
    for (const sym of pool) if (fetched[sym]) gathered[sym] = fetched[sym];
    ready = waiting().length === 0 || jstMinutes(now) >= GAP_DECIDE_BY;
  }
  const quotes: Record<string, OpenQuote> = ready ? { ...state.gathered, ...fetched } : fetched;

  // 時刻を決めて売る・損切りを遅らせる設定なら、保有中の銘柄の5分足を取る。最後の足は形成中かもしれないので、大引け後までは使わない
  const intraday: Record<string, Bar[]> = {};
  if (usesIntradayExit(settings)) {
    for (const held of gapPositions(state)) {
      try {
        const bars = (await provider.intraday(held.symbol, "5m", "1d", now)).filter((b) => jstDate(b.t) === date && inSession(b.t));
        intraday[held.symbol] = dayComplete ? bars : bars.slice(0, -1);
      } catch (e) {
        errors.push(`${held.symbol}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // 寄り値がそろうまでは安寄り買いの判断をさせない（保有中の銘柄の損切りと決済は動かす）
  const trades = dailyTick(state, ready ? settings : { ...settings, symbols: [] }, quotes, now, dayComplete, intraday);
  // 判断が済んだ銘柄の値は捨てる（持ち越しの決済待ちで判断が先送りになった銘柄は残す）
  for (const sym of Object.keys(state.gathered ?? {})) if (state.decided?.includes(sym)) delete state.gathered![sym];
  if (state.gathered && Object.keys(state.gathered).length === 0) delete state.gathered;
  if (created || trades.length > 0 || JSON.stringify(state) !== before) statements.push(...saveStatements(db, state, trades));
  if (statements.length > 0) await db.batch(statements);
  return { date, processedBars: Object.keys(quotes).length, trades, errors };
}
