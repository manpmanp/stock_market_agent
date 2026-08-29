-- composite_score was declared NOT NULL, but insertRankingsBatch (see
-- src/scoring/run.ts) has always deliberately written a NULL composite_score
-- for "excluded" rows -- tickers that don't have enough data to score at all
-- (see missingCriticalFields in src/scoring/score.ts). That mismatch went
-- unnoticed while the universe was 20 well-covered tickers that never hit
-- the excluded path; with 169 tickers (many newly added), some now do, and
-- the insert throws SQLITE_CONSTRAINT_NOTNULL, aborting the whole scoring
-- run. SQLite can't drop a NOT NULL constraint in place, so this rebuilds
-- the table with the same columns (through migration 0003) minus that
-- constraint.

CREATE TABLE rankings_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at          TEXT NOT NULL DEFAULT (datetime('now')),
  horizon         TEXT NOT NULL,
  ticker          TEXT NOT NULL REFERENCES stocks(ticker),
  rank            INTEGER NOT NULL,
  composite_score REAL,            -- NULL for excluded rows -- see comment above
  valuation_score REAL,
  quality_score   REAL,
  momentum_score  REAL,
  valuation_gap_pct REAL,
  rationale       TEXT,
  excluded_reason TEXT,
  style           TEXT,
  valuation_label TEXT,
  quality_label   TEXT,
  entry_state     TEXT
);

INSERT INTO rankings_new (
  id, run_at, horizon, ticker, rank, composite_score, valuation_score, quality_score,
  momentum_score, valuation_gap_pct, rationale, excluded_reason, style,
  valuation_label, quality_label, entry_state
)
SELECT
  id, run_at, horizon, ticker, rank, composite_score, valuation_score, quality_score,
  momentum_score, valuation_gap_pct, rationale, excluded_reason, style,
  valuation_label, quality_label, entry_state
FROM rankings;

DROP TABLE rankings;
ALTER TABLE rankings_new RENAME TO rankings;

CREATE INDEX IF NOT EXISTS idx_rankings_run_horizon
  ON rankings(run_at DESC, horizon, rank);
