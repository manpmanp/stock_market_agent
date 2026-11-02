// Turns a backtest run's fitted Decision Lab weights (data/backtest_report.json's
// decision_weights.final, see harness.py) into a live weight update -- but
// only after PROMOTION_STREAK consecutive runs pass the promotion bar for
// that horizon, and only ever as a PARTIAL reallocation, never a full
// 10-factor replacement. See the doc comment on computeNewWeights below for
// why that split matters.
//
// This script only WRITES the SQL file (data/.promote-weights.sql) --
// scripts/backtest.sh applies it with `wrangler d1 execute --file=`, same
// convention as push-to-d1.ts, so the exact SQL that would change live
// weights is always inspectable before it runs, not hidden inside this
// script's own D1 access.
//
// One-time prerequisite: `npm run db:migrate:remote` must have applied
// migrations/0008_decision_weight_promotion.sql (adds
// decision_weight_promotion_history). scripts/backtest.sh checks for this
// the same way it already checks for backtest_runs.
//
// Usage: node scripts/backtest/promote-weights.ts
//   reads:  data/backtest_report.json (this run's harness output)
//           decision_weight_sets, decision_weight_promotion_history (via
//           `wrangler d1 execute --json`, spawned directly -- the
//           promotion decision depends on live D1 state: the currently
//           active weights, and the pass/fail streak so far)
//   writes: data/.promote-weights.sql

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DB_NAME = "stock-agent-db";
const REPORT_PATH = join(process.cwd(), "data", "backtest_report.json");
const OUT_SQL = join(process.cwd(), "data", ".promote-weights.sql");

// Consecutive passing runs required, no gap, before a horizon's fitted
// weights actually get promoted -- one good run is noise, not signal.
export const PROMOTION_STREAK = 3;

// Backtest dataset column -> live Decision Lab factor key (see
// build-dataset.ts's DECISION_FACTORS and src/decision/types.ts's FACTORS).
export const FACTOR_MAP: Record<string, string> = {
  factor_entry: "entry",
  factor_technical: "technical",
  factor_valuation_partial: "valuation",
  factor_risk_partial: "risk",
};

export const HORIZONS = ["short", "medium", "long"] as const;

export const ALL_FACTORS = [
  "quality", "growth", "financial_strength", "valuation", "future_potential",
  "technical", "entry", "risk", "catalyst", "market_regime",
];

export interface PromotionHistoryRow {
  horizon: string;
  pass: number | boolean;
}

/** Does this run pass the promotion bar on its own? Beating the linear
 *  baseline (the same bootstrap significance check every other model here
 *  goes through) AND a positive mean IC -- both, not either, since
 *  "beats a weak baseline" alone isn't the same as "actually predicts
 *  anything." */
export function passesBar(beatsLinear: boolean, meanIc: number | null, fitted: Record<string, number> | null): boolean {
  return fitted !== null && beatsLinear && meanIc !== null && meanIc > 0;
}

/** True only if this run's pass, plus the PROMOTION_STREAK-1 most recent
 *  PRIOR runs for this horizon (already in D1, ordered newest-first), are
 *  ALL passes with no gap. `priorForHorizon` must already be filtered to
 *  one horizon and sorted newest-first by the caller. */
export function streakComplete(thisRunPasses: boolean, priorForHorizon: PromotionHistoryRow[]): boolean {
  if (!thisRunPasses) return false;
  const needed = PROMOTION_STREAK - 1;
  const recent = priorForHorizon.slice(0, needed);
  return recent.length === needed && recent.every((r) => Number(r.pass) === 1);
}

/** The actual safety-critical design choice: promotion does NOT replace
 *  all 10 factors. Decision Lab's other 6 factors (quality, growth,
 *  financial_strength, future_potential, catalyst, market_regime) have no
 *  point-in-time-clean training data yet (see build-dataset.ts) -- they
 *  are UNTESTED, not disproven. Zeroing them out because 4 unrelated
 *  factors fit well would silently throw away real, plausible signal that
 *  was simply never given a chance to compete. Instead: take whatever
 *  combined weight share the 4 trainable factors (entry/technical/
 *  valuation/risk) currently hold in the live weight vector, and
 *  reallocate ONLY that share among themselves, in the fitted
 *  proportions. The other 6 factors keep their current weights exactly.
 *  Extend this once fundamentals history (src/lib/db.ts
 *  pruneOldSnapshots) is deep enough to fit all 10 at once. */
export function computeNewWeights(current: Record<string, number>, fitted: Record<string, number>): Record<string, number> {
  const trainableKeys = Object.values(FACTOR_MAP);
  const currentShare = trainableKeys.reduce((a, k) => a + (current[k] ?? 0), 0);
  const next: Record<string, number> = { ...current };
  for (const [col, key] of Object.entries(FACTOR_MAP)) {
    next[key] = currentShare * (fitted[col] ?? 0);
  }
  // Guard against float drift so the live engine's exact-sum-to-1 check
  // (validateWeights, 1e-6 tolerance) never rejects an auto-promotion.
  const total = ALL_FACTORS.reduce((a, k) => a + (next[k] ?? 0), 0);
  if (total > 0) for (const k of ALL_FACTORS) next[k] = (next[k] ?? 0) / total;
  return next;
}

// --- Rollback monitoring -------------------------------------------------
//
// Separate question from promotion above: promotion asks "would a fresh
// refit pass right now" -- this asks "is what's ACTUALLY LIVE right now
// still working." harness.py computes this every run as
// live_active_holdout (see evaluate_live_active_weights), evaluating the
// CURRENTLY ACTIVE, frozen weight vector -- not a refit -- against this
// run's holdout. If a horizon's live weights were reached via a promotion
// (note starts with "auto-promoted") and that check fails ROLLBACK_STREAK
// consecutive runs with no gap, this reverts to whatever was active
// immediately before that promotion. A horizon still on its original
// DEFAULT_WEIGHTS (never promoted) is never touched by this -- there's
// nothing to roll back to that's better than the hand-set starting point.

export const ROLLBACK_STREAK = 3;

export interface MonitoringHistoryRow {
  horizon: string;
  pass: number | boolean;
}

export function monitoringPasses(liveIc: number | null): boolean {
  return liveIc !== null && liveIc > 0;
}

/** Mirrors streakComplete's shape but for consecutive FAILURES. */
export function rollbackStreakComplete(thisRunFails: boolean, priorForHorizon: MonitoringHistoryRow[]): boolean {
  if (!thisRunFails) return false;
  const needed = ROLLBACK_STREAK - 1;
  const recent = priorForHorizon.slice(0, needed);
  return recent.length === needed && recent.every((r) => Number(r.pass) === 0);
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

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
  let report: { horizons?: Array<Record<string, unknown>> };
  try {
    report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
  } catch {
    console.error(`${REPORT_PATH} not found -- run the harness first (scripts/backtest.sh does this for you).`);
    process.exit(1);
  }

  console.log("Reading current active weights and promotion history from D1...");
  const activeRows = d1Query(`SELECT horizon, weights_json FROM decision_weight_sets WHERE is_active = 1`);
  const activeByHorizon = new Map<string, Record<string, number>>();
  for (const r of activeRows) activeByHorizon.set(String(r.horizon), JSON.parse(String(r.weights_json)));

  const historyRows = d1Query(
    `SELECT horizon, created_at, pass FROM decision_weight_promotion_history ORDER BY created_at DESC LIMIT 200`
  ) as unknown as PromotionHistoryRow[];

  // Full decision_weight_sets history (not just the active row) -- needed
  // to tell whether the active row came from a promotion, and if so, what
  // was active right before it (the rollback target).
  const weightSetHistory = d1Query(
    `SELECT id, horizon, weights_json, is_active, note, created_at FROM decision_weight_sets ORDER BY horizon, created_at DESC`
  ) as unknown as Array<{ id: number; horizon: string; weights_json: string; is_active: number; note: string | null; created_at: string }>;

  const monitoringHistoryRows = d1Query(
    `SELECT horizon, created_at, pass FROM live_weight_monitoring_history ORDER BY created_at DESC LIMIT 200`
  ) as unknown as MonitoringHistoryRow[];

  const sqlLines: string[] = [];
  const now = new Date().toISOString();

  for (const h of report.horizons ?? []) {
    const horizon = String(h.horizon);
    if (!(HORIZONS as readonly string[]).includes(horizon)) continue;
    if (h.skipped) {
      console.log(`[${horizon}] skipped in this backtest run -- no promotion record.`);
      continue;
    }

    const dw = h.decision_weights as { final: Record<string, number> | null } | undefined;
    const fitted = dw?.final ?? null;
    const sig = (h.significance_vs_linear as Record<string, { beats_linear?: boolean }>)?.decision_weights;
    const walk = (h.walk_forward as Record<string, { mean_ic?: number | null }>)?.decision_weights;
    const beatsLinear = !!sig?.beats_linear;
    const meanIc = walk?.mean_ic ?? null;
    const pass = passesBar(beatsLinear, meanIc, fitted);

    console.log(`[${horizon}] this run: beats_linear=${beatsLinear} mean_ic=${meanIc} fitted=${fitted ? "yes" : "no"} -> pass=${pass}`);

    const priorForHorizon = historyRows.filter((r) => r.horizon === horizon);
    const willPromote = pass && fitted !== null && streakComplete(true, priorForHorizon) && activeByHorizon.has(horizon);

    let promotedWeightsJson: string | null = null;
    if (willPromote && fitted) {
      const current = activeByHorizon.get(horizon)!;
      const newWeights = computeNewWeights(current, fitted);
      promotedWeightsJson = JSON.stringify(newWeights);
      const note = `auto-promoted: ${PROMOTION_STREAK} consecutive backtest runs where the fitted entry/technical/valuation/risk weights beat the linear baseline (partial reallocation -- other 6 factors unchanged) -- ${now}`;
      sqlLines.push(`UPDATE decision_weight_sets SET is_active = 0 WHERE horizon = '${horizon}' AND is_active = 1;`);
      sqlLines.push(
        `INSERT INTO decision_weight_sets (horizon, weights_json, is_active, note) VALUES ('${horizon}', '${sqlEscape(promotedWeightsJson)}', 1, '${sqlEscape(note)}');`
      );
      console.log(`[${horizon}] PROMOTED -- new live weights: ${promotedWeightsJson}`);
    } else if (pass) {
      const passesSoFar = 1 + priorForHorizon.slice(0, PROMOTION_STREAK - 1).filter((r) => Number(r.pass) === 1).length;
      console.log(`[${horizon}] passed, but streak isn't at ${PROMOTION_STREAK} yet (${passesSoFar}/${PROMOTION_STREAK}) -- not promoting.`);
    }

    // Rollback monitoring -- skipped the same run a promotion just
    // happened (nothing to compare the OLD active weights against that
    // matters once they're about to be replaced anyway).
    const liveActive = h.live_active_holdout as { ic: number | null; hit_rate: number | null; n: number } | null | undefined;
    if (liveActive && !willPromote) {
      const liveIc = liveActive.ic;
      const monitorPass = monitoringPasses(liveIc);
      const priorMonitoring = monitoringHistoryRows.filter((r) => r.horizon === horizon);

      const horizonSets = weightSetHistory.filter((r) => r.horizon === horizon);
      const currentSet = horizonSets.find((r) => r.is_active === 1);
      const isPromotion = !!currentSet?.note?.startsWith("auto-promoted");
      let rolledBack = false;

      if (isPromotion && currentSet) {
        const idx = horizonSets.findIndex((r) => r.id === currentSet.id);
        const previousSet = idx >= 0 ? horizonSets[idx + 1] : undefined;
        if (previousSet && rollbackStreakComplete(!monitorPass, priorMonitoring)) {
          rolledBack = true;
          const rollbackNote = `auto-rolled-back: live weights failed ${ROLLBACK_STREAK} consecutive holdout checks after promotion -- reverted to the weights active before that promotion -- ${now}`;
          sqlLines.push(`UPDATE decision_weight_sets SET is_active = 0 WHERE horizon = '${horizon}' AND is_active = 1;`);
          sqlLines.push(
            `INSERT INTO decision_weight_sets (horizon, weights_json, is_active, note) VALUES ('${horizon}', '${sqlEscape(previousSet.weights_json)}', 1, '${sqlEscape(rollbackNote)}');`
          );
          console.log(`[${horizon}] ROLLED BACK -- reverted to weights from ${previousSet.created_at}`);
        } else if (!monitorPass) {
          const failsSoFar = 1 + priorMonitoring.slice(0, ROLLBACK_STREAK - 1).filter((r) => Number(r.pass) === 0).length;
          console.log(`[${horizon}] live weights failed this run's holdout check (${failsSoFar}/${ROLLBACK_STREAK} consecutive) -- not rolling back yet.`);
        }
      }

      sqlLines.push(
        `INSERT INTO live_weight_monitoring_history (horizon, created_at, live_ic, pass, rolled_back) VALUES (` +
          `'${horizon}', '${now}', ${liveIc === null ? "NULL" : liveIc}, ${monitorPass ? 1 : 0}, ${rolledBack ? 1 : 0});`
      );
    } else if (!liveActive) {
      console.log(`[${horizon}] live-weight monitoring not evaluated this run (no active weights recorded yet, or no active row in D1 for this horizon).`);
    }

    sqlLines.push(
      `INSERT INTO decision_weight_promotion_history ` +
        `(horizon, created_at, fitted_weights_json, mean_ic, beats_linear, pass, promoted, promoted_weights_json) VALUES (` +
        `'${horizon}', '${now}', ${fitted ? `'${sqlEscape(JSON.stringify(fitted))}'` : "NULL"}, ` +
        `${meanIc === null ? "NULL" : meanIc}, ${beatsLinear ? 1 : 0}, ${pass ? 1 : 0}, ` +
        `${willPromote ? 1 : 0}, ${promotedWeightsJson ? `'${sqlEscape(promotedWeightsJson)}'` : "NULL"});`
    );
  }

  writeFileSync(OUT_SQL, sqlLines.join("\n") + "\n");
  console.log(`Wrote ${OUT_SQL} (${sqlLines.length} statement(s)) -- scripts/backtest.sh applies this next via wrangler d1 execute.`);
}

if (process.argv[1] && process.argv[1].endsWith("promote-weights.ts")) {
  main();
}
