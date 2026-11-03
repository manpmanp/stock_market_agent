-- Stage A of the universe-widening screen: a cheap, broad pass over a much
-- larger ticker pool than config/universe.json's hand-picked list (see
-- config/broad-universe.json, S&P 500 to start), looking only at valuation
-- ratios and a short price-momentum read -- not the full fundamentals/
-- indicator/Decision Lab pipeline every tracked ticker gets. Separate
-- table from fundamentals_snapshot/technical_snapshot on purpose: this is
-- throwaway screening data for tickers that may never become fully
-- tracked, not the real per-ticker history those tables hold.
CREATE TABLE IF NOT EXISTS broad_screen_snapshot (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker          TEXT NOT NULL,
  pulled_at       TEXT NOT NULL DEFAULT (datetime('now')),
  trailing_pe     REAL,
  price_to_book   REAL,
  ev_to_ebitda    REAL,
  momentum_3m_pct REAL,
  -- 0-100 average of this run's cross-sectional percentile on each
  -- available metric (lower PE/PB/EV-EBITDA = better, higher momentum =
  -- better) -- see src/screening/run.ts. NULL until computed at the end
  -- of a run, once every candidate's raw values are in.
  screen_score    REAL
);
CREATE INDEX IF NOT EXISTS idx_broad_screen_ticker_pulled
  ON broad_screen_snapshot(ticker, pulled_at DESC);
CREATE INDEX IF NOT EXISTS idx_broad_screen_pulled_score
  ON broad_screen_snapshot(pulled_at DESC, screen_score DESC);

-- Tickers Stage A auto-promoted into full tracking. stocks/price_history
-- etc. is where their real data lives once promoted -- this table is just
-- the record of WHY/WHEN a ticker joined config/universe.json's static
-- list dynamically, since a Cloudflare Worker can't edit that file (or
-- any source file) at runtime. loadFullUniverse() (ingestion/run.ts)
-- reads this table and unions it with the static config file to decide
-- what the live universe actually is.
CREATE TABLE IF NOT EXISTS promoted_tickers (
  ticker         TEXT PRIMARY KEY,
  exchange       TEXT NOT NULL,
  region         TEXT NOT NULL,
  currency       TEXT NOT NULL,
  promoted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  screen_score   REAL,
  source         TEXT NOT NULL DEFAULT 'broad_screen_stage_a'
);
