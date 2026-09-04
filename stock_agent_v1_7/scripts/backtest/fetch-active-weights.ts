// Pulls the CURRENTLY ACTIVE Decision Lab weight vector for each horizon
// out of D1, extracts just the 4 trainable factors (entry, technical,
// valuation, risk -- see build-dataset.ts's DECISION_FACTORS), renormalizes
// THOSE FOUR to sum to 1 among themselves, and writes the result so
// harness.py can evaluate "is what's actually live right now still
// working" on this run's holdout data -- separate from, and a different
// question than, "would a freshly refit vector pass" (see
// decision_weights in harness.py's report). This is what makes rollback
// monitoring possible: promote-weights.ts reads harness.py's resulting
// live_active_holdout numbers back out of the report.
//
// Runs BEFORE the harness (see scripts/backtest.sh) so the active-weights
// file exists by the time harness.py needs it. If D1 has no active row yet
// for a horizon (fresh install, never scored), that horizon is just
// omitted -- harness.py skips live-monitoring for it rather than failing.
//
// Usage: node scripts/backtest/fetch-active-weights.ts
//   writes: data/.active_decision_weights.json

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const DB_NAME = "stock-agent-db";
const OUT_PATH = join(process.cwd(), "data", ".active_decision_weights.json");

// Live Decision Lab factor key -> backtest dataset column, the inverse of
// promote-weights.ts's FACTOR_MAP (kept as its own copy, not a shared
// import, since this runs standalone before the harness and shouldn't
// depend on promote-weights.ts's module having no side effects on import).
const TRAINABLE_FACTORS = ["entry", "technical", "valuation", "risk"] as const;
const COLUMN_OF: Record<string, string> = {
  entry: "factor_entry",
  technical: "factor_technical",
  valuation: "factor_valuation_partial",
  risk: "factor_risk_partial",
};

function d1Query(sql: string): Record<string, unknown>[] {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", DB_NAME, "--remote", "--json", "--command", sql], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const parsed = JSON.parse(out) as unknown;
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const results: Record<string, unknown>[] = [];
  for (const entry of arr) {
    const r = (entry as { results?: unknown[] })?.results;
    if (Array.isArray(r)) results.push(...(r as Record<string, unknown>[]));
  }
  return results;
}

function main() {
  console.log("Fetching currently active Decision Lab weights from D1...");
  const rows = d1Query(`SELECT horizon, weights_json FROM decision_weight_sets WHERE is_active = 1`);

  const out: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const horizon = String(row.horizon);
    const weights = JSON.parse(String(row.weights_json)) as Record<string, number>;
    const share = TRAINABLE_FACTORS.reduce((a, f) => a + (weights[f] ?? 0), 0);
    if (share <= 0) {
      console.log(`[${horizon}] active weights give the 4 trainable factors zero combined share -- skipping live-monitoring for this horizon.`);
      continue;
    }
    const byColumn: Record<string, number> = {};
    for (const f of TRAINABLE_FACTORS) byColumn[COLUMN_OF[f]!] = (weights[f] ?? 0) / share;
    out[horizon] = byColumn;
  }

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_PATH} for ${Object.keys(out).length} horizon(s).`);
}

main();
