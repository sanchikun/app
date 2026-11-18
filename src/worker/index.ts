import { Hono } from "hono";
import { runBacktest } from "../core/backtest";
import { jstDate } from "../core/market";
import { normalizeSymbol, parseSettings } from "../core/types";
import { INTERVAL_SECONDS, RANGES, getProvider } from "../data/provider";
import type { Interval, Range } from "../data/provider";
import { getDay, getSettings, paperTick, saveSettings } from "./paper";

interface Env {
  DB: D1Database;
  DATA_SOURCE?: string;
  /** 設定すると、更新系のAPIに Authorization: Bearer <token> が必要になる */
  API_TOKEN?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

app.use("/api/*", async (c, next) => {
  const token = c.env.API_TOKEN;
  if (token && c.req.method !== "GET" && c.req.header("Authorization") !== `Bearer ${token}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

app.get("/api/status", async (c) => {
  const date = jstDate(Date.now() / 1000);
  const [settings, day] = await Promise.all([getSettings(c.env.DB), getDay(c.env.DB, date)]);
  const pnl = day?.realizedPnl ?? 0;
  return c.json({
    mode: "paper",
    dataSource: c.env.DATA_SOURCE === "synthetic" ? "synthetic" : "yahoo",
    enabled: settings.enabled,
    date,
    realizedPnl: pnl,
    dailyTargetYen: settings.dailyTargetYen,
    targetReached: pnl >= settings.dailyTargetYen,
    tradeCount: day?.tradeCount ?? 0,
    halted: day?.halted ?? null,
    position: day?.position ?? null,
    pending: day?.pending ?? null,
  });
});

app.get("/api/positions", async (c) => {
  const day = await getDay(c.env.DB, jstDate(Date.now() / 1000));
  return c.json({ positions: day?.position ? [day.position] : [] });
});

app.get("/api/trades", async (c) => {
  const date = c.req.query("date");
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
  const stmt = date
    ? c.env.DB.prepare("SELECT * FROM trades WHERE date = ? ORDER BY exit_t DESC").bind(date)
    : c.env.DB.prepare("SELECT * FROM trades ORDER BY exit_t DESC LIMIT 200");
  return c.json({ trades: (await stmt.all()).results });
});

app.get("/api/pnl/daily", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT date, realized_pnl AS pnl, trade_count AS trades, halted FROM days ORDER BY date DESC LIMIT 365",
  ).all();
  return c.json({ daily: results });
});

app.get("/api/settings", async (c) => c.json(await getSettings(c.env.DB)));

app.put("/api/settings", async (c) => {
  const current = await getSettings(c.env.DB);
  let next;
  try {
    next = parseSettings(await jsonBody(c.req.raw), current);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  await saveSettings(c.env.DB, next);
  return c.json(next);
});

for (const [path, enabled] of [["/api/bot/start", true], ["/api/bot/stop", false]] as const) {
  app.post(path, async (c) => {
    const settings = { ...(await getSettings(c.env.DB)), enabled };
    await saveSettings(c.env.DB, settings);
    return c.json({ enabled });
  });
}

/** 定期実行と同じ処理を手動で1回動かす */
app.post("/api/paper/tick", async (c) => {
  const body = await jsonBody(c.req.raw);
  // 合成データのときだけ、動作確認のために現在時刻を差し替えられる
  const now =
    c.env.DATA_SOURCE === "synthetic" && typeof body.now === "number" ? body.now : Math.floor(Date.now() / 1000);
  return c.json(await paperTick(c.env.DB, getProvider(c.env.DATA_SOURCE), now));
});

app.post("/api/backtest", async (c) => {
  const body = await jsonBody(c.req.raw);
  const interval = (body.interval ?? "5m") as Interval;
  const range = (body.range ?? "60d") as Range;
  let symbol;
  let settings;
  try {
    if (typeof body.symbol !== "string") throw new Error("symbol is required");
    symbol = normalizeSymbol(body.symbol);
    if (!(interval in INTERVAL_SECONDS)) throw new Error("interval must be 1m, 5m or 15m");
    if (!RANGES.includes(range)) throw new Error(`range must be one of ${RANGES.join(", ")}`);
    if (interval === "1m" && (range === "1mo" || range === "60d")) throw new Error("1m bars are limited to range 7d");
    // 保存済みの設定に、このリクエストだけの上書きを重ねる（保存はしない）
    settings = parseSettings(body.settings ?? {}, await getSettings(c.env.DB));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  const source = body.source === "synthetic" ? "synthetic" : c.env.DATA_SOURCE;
  let bars;
  try {
    bars = await getProvider(source).intraday(symbol, interval, range, Math.floor(Date.now() / 1000));
  } catch (e) {
    return c.json({ error: `failed to fetch bars: ${(e as Error).message}` }, 502);
  }
  return c.json({ source: source === "synthetic" ? "synthetic" : "yahoo", interval, range, ...runBacktest(symbol, bars, settings) });
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      paperTick(env.DB, getProvider(env.DATA_SOURCE), Math.floor(Date.now() / 1000)).then((r) => {
        if (r.errors.length) console.error("paper tick errors", r.errors);
      }),
    );
  },
};
