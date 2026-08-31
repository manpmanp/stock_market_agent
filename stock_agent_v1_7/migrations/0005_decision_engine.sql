-- Second, independent scoring/decision system (src/decision/*), run alongside
-- the existing self-relative rankings rather than replacing them -- see
-- src/decision/README.md for the full design rationale. This is a
-- 10-factor weighted decision engine (quality, growth, financial_strength,
-- valuation, future_potential, technical, entry, risk, catalyst,
-- market_regime) with per-horizon weight vectors that live in D1 so they
-- can be tuned from the /decision-lab page without a redeploy.

-- One row per (horizon, version). Only one row per horizon has
-- is_active = 1 at a time -- updating weights inserts a new row and flips
-- the old one off, so the full tuning history is kept rather than
-- overwritten. horizon is 'short' | 'medium' | 'long' (note: "medium", not
-- "mid" -- this system uses the uploaded spec's own horizon naming, kept
-- deliberately distinct from the existing rankings table's 'short'/'mid'/
-- 'long' so the two systems' horizons are never silently conflated).
CREATE TABLE IF NOT EXISTS decision_weight_sets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  horizon      TEXT NOT NULL,
  weights_json TEXT NOT NULL,   -- {"quality":0.19,"growth":0.19,...} sums to 1.0
  is_active    INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_decision_weight_sets_horizon_active
  ON decision_weight_sets(horizon, is_active, created_at DESC);

-- One row per (ticker, horizon, run_at). factor_scores_json holds the raw
-- 0-100 input to the weighted average (see src/decision/factors.ts) so the
-- /decision-lab page can show a full breakdown, not just the final number.
CREATE TABLE IF NOT EXISTS decisions (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at                    TEXT NOT NULL DEFAULT (datetime('now')),
  ticker                    TEXT NOT NULL REFERENCES stocks(ticker),
  horizon                   TEXT NOT NULL,
  score                     REAL,
  decision                  TEXT,             -- STRONG BUY .. STRONG SELL
  confidence                REAL,
  valuation_status          TEXT,             -- DEEPLY_UNDERVALUED .. VERY_EXPENSIVE (raw price/fair-value ratio)
  entry_status              TEXT,             -- EXCELLENT_ENTRY .. POOR_ENTRY (from the entry factor score)
  factor_scores_json        TEXT NOT NULL,    -- {"quality":82,...} the 10 raw 0-100 factor inputs
  factor_contribution_json  TEXT NOT NULL,    -- {"quality":15.2,...} score * weight, per factor
  warnings_json             TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_decisions_run_horizon
  ON decisions(run_at DESC, horizon, score DESC);
