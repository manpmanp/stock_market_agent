-- Tracks every backtest run's pass/fail against the promotion bar for the
-- trainable subset of Decision Lab's weights (see
-- scripts/backtest/promote-weights.ts), and what actually got promoted to
-- decision_weight_sets when a horizon reached PROMOTION_STREAK consecutive
-- passes. One row per (horizon, backtest run) -- append-only, same
-- convention as decision_weight_sets and backtest_runs.
CREATE TABLE decision_weight_promotion_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horizon TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- The 4-factor fitted proportions (entry/technical/valuation/risk,
  -- summing to 1) from this run's harness.py output. NULL if the harness
  -- couldn't fit this horizon this run (not enough clean data).
  fitted_weights_json TEXT,
  mean_ic REAL,
  beats_linear INTEGER NOT NULL,
  -- This run's pass/fail against the promotion bar (beats_linear AND
  -- mean_ic > 0). A promotion requires PROMOTION_STREAK consecutive
  -- passes with no gap, not just one good run.
  pass INTEGER NOT NULL,
  -- 1 only on the run that actually triggered a promotion (i.e. this row
  -- completed the streak). promoted_weights_json is the FULL 10-factor
  -- vector that got written to decision_weight_sets on that run -- see
  -- promote-weights.ts's doc comment on why that's a partial reallocation
  -- of the 4 trainable factors' existing combined share, not a full
  -- 10-factor replacement.
  promoted INTEGER NOT NULL DEFAULT 0,
  promoted_weights_json TEXT
);
CREATE INDEX idx_decision_weight_promotion_history_horizon_created
  ON decision_weight_promotion_history(horizon, created_at DESC);
