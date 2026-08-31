-- Initial schema. D1 is SQLite-compatible; this also runs unmodified
-- against a local sqlite3 file for offline development/testing.

CREATE TABLE IF NOT EXISTS stocks (
  ticker      TEXT PRIMARY KEY,   -- Yahoo Finance symbol, e.g. AAPL, VOLV-B.ST
  exchange    TEXT NOT NULL,
  isin        TEXT,
  name        TEXT,
  sector      TEXT,
  industry    TEXT,
  currency    TEXT NOT NULL,
  region      TEXT NOT NULL,      -- 'nordic' | 'us' | 'global'
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_history (
  ticker      TEXT NOT NULL REFERENCES stocks(ticker),
  date        TEXT NOT NULL,       -- ISO date, YYYY-MM-DD
  open        REAL,
  high        REAL,
  low         REAL,
  close       REAL,
  adj_close   REAL,
  volume      INTEGER,
  pulled_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ticker, date)
);
CREATE INDEX IF NOT EXISTS idx_price_history_ticker_date
  ON price_history(ticker, date DESC);

CREATE TABLE IF NOT EXISTS fundamentals_snapshot (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker              TEXT NOT NULL REFERENCES stocks(ticker),
  pulled_at           TEXT NOT NULL DEFAULT (datetime('now')),
  trailing_pe         REAL,
  forward_pe          REAL,
  price_to_book       REAL,
  price_to_sales      REAL,
  ev_to_ebitda        REAL,
  dividend_yield      REAL,
  payout_ratio        REAL,
  revenue_growth_yoy  REAL,
  earnings_growth_yoy REAL,
  gross_margin        REAL,
  operating_margin    REAL,
  net_margin          REAL,
  return_on_equity    REAL,
  return_on_invested_capital REAL,
  debt_to_equity      REAL,
  free_cash_flow      REAL,
  fcf_yield           REAL,
  market_cap          REAL,
  peg_ratio           REAL
);
CREATE INDEX IF NOT EXISTS idx_fundamentals_ticker_pulled
  ON fundamentals_snapshot(ticker, pulled_at DESC);

CREATE TABLE IF NOT EXISTS valuation_estimates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker        TEXT NOT NULL REFERENCES stocks(ticker),
  source        TEXT NOT NULL,     -- 'yahoo_finance' in v1; more sources in v2
  pulled_at     TEXT NOT NULL DEFAULT (datetime('now')),
  fair_value    REAL,
  target_price  REAL,
  target_low    REAL,
  target_high   REAL,
  rating        TEXT,              -- normalized: strong_buy/buy/hold/sell/strong_sell
  num_analysts  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_valuation_ticker_pulled
  ON valuation_estimates(ticker, pulled_at DESC);

CREATE TABLE IF NOT EXISTS technical_snapshot (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker          TEXT NOT NULL REFERENCES stocks(ticker),
  pulled_at       TEXT NOT NULL DEFAULT (datetime('now')),
  as_of_date      TEXT NOT NULL,   -- last price_history date the indicators are computed through
  rsi_14          REAL,
  macd            REAL,
  macd_signal     REAL,
  sma_50          REAL,
  sma_100         REAL,
  sma_200         REAL,
  price_vs_sma50  REAL,            -- % distance, precomputed for convenience
  price_vs_sma200 REAL,
  volatility_30d  REAL,            -- annualized stdev of daily returns
  volume_trend_20d REAL            -- 20d avg volume / 90d avg volume
);
CREATE INDEX IF NOT EXISTS idx_technical_ticker_pulled
  ON technical_snapshot(ticker, pulled_at DESC);

CREATE TABLE IF NOT EXISTS rankings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at          TEXT NOT NULL DEFAULT (datetime('now')),
  horizon         TEXT NOT NULL,   -- 'short' | 'mid' | 'long'
  ticker          TEXT NOT NULL REFERENCES stocks(ticker),
  rank            INTEGER NOT NULL,
  composite_score REAL NOT NULL,
  valuation_score REAL,
  quality_score   REAL,
  momentum_score  REAL,
  valuation_gap_pct REAL,          -- price vs avg fair value, negative = undervalued
  rationale       TEXT,
  excluded_reason TEXT             -- non-null if this row is an "excluded, insufficient data" entry
);
CREATE INDEX IF NOT EXISTS idx_rankings_run_horizon
  ON rankings(run_at DESC, horizon, rank);

CREATE TABLE IF NOT EXISTS source_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,       -- e.g. 'yahoo_finance_chart', 'yahoo_finance_quotesummary'
  ticker      TEXT,
  url         TEXT,
  status      TEXT NOT NULL,       -- 'ok' | 'error' | 'skipped_rate_limit' | 'no_data'
  http_status INTEGER,
  error       TEXT,
  pulled_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_source_log_pulled ON source_log(pulled_at DESC);
