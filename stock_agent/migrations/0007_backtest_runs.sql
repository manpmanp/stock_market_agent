-- Published results from scripts/backtest.sh (the v7 walk-forward model
-- comparison harness, scripts/backtest/harness.py). This table is what
-- lets the /decision-lab "Model Results" tab show real training/validation
-- output instead of just describing the methodology in prose -- until a
-- run is pushed here, that tab has nothing to show.
--
-- One row per completed backtest run. report_json is the harness's own
-- data/backtest_report.json, stored verbatim (same "store the whole
-- structure as JSON" convention already used for
-- decision_weight_sets.weights_json) -- the harness's shape is the source
-- of truth for what a run contains, not a column-per-metric schema here
-- that would need a migration every time the harness's report shape
-- changes.
--
-- Nothing in this project's live decision engine reads this table --
-- see decisionLab.ts's Model Selection & Testing tab: the backtest is
-- purely evaluative until a model is deliberately wired into
-- src/decision/run.ts, which hasn't happened yet.
CREATE TABLE backtest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  report_json TEXT NOT NULL
);

CREATE INDEX idx_backtest_runs_created_at ON backtest_runs(created_at DESC);
