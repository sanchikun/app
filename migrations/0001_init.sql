CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE days (
  date TEXT PRIMARY KEY,
  realized_pnl REAL NOT NULL,
  trade_count INTEGER NOT NULL,
  halted TEXT,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  shares INTEGER NOT NULL,
  entry_t INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  exit_t INTEGER NOT NULL,
  exit_price REAL NOT NULL,
  pnl REAL NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX trades_date ON trades (date);
