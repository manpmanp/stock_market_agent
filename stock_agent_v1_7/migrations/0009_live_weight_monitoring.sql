-- Tracks how the CURRENTLY ACTIVE (frozen) Decision Lab weights perform on
-- each run's fresh holdout data -- separate from
-- decision_weight_promotion_history, which tracks whether a freshly REFIT
-- vector would pass, not whether what's actually live right now still
-- holds up. This is the rollback signal: if what's live was reached via a
-- promotion and then degrades for ROLLBACK_STREAK consecutive runs (see
-- promote-weights.ts), it gets automatically reverted to the weights that
-- were active immediately before that promotion.
CREATE TABLE live_weight_monitoring_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horizon TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- IC of the currently-active weight vector (frozen, not refit) on this
  -- run's final holdout. NULL if there wasn't enough clean holdout data.
  live_ic REAL,
  pass INTEGER NOT NULL,
  rolled_back INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_live_weight_monitoring_history_horizon_created
  ON live_weight_monitoring_history(horizon, created_at DESC);
