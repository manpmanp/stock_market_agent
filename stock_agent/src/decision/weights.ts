// D1-backed weight vectors for the decision engine -- the third of the
// user's three explicit design requirements ("Data-driven, adjustable
// without redeploy"). DEFAULT_WEIGHTS in types.ts is only the seed value
// written into decision_weight_sets the first time a horizon is read with
// no active row yet; from then on the live D1 row is what scoring
// actually uses, and POST /weights (src/index.ts) can change it without a
// deploy.
//
// One row per (horizon, version); updating flips is_active off the old
// row and inserts a new one rather than UPDATE-in-place, so the full
// tuning history survives in the table (matches the pattern already used
// for rankings/decisions -- append, don't overwrite).

import type { Env } from "../lib/types.js";
import { DEFAULT_WEIGHTS, FACTORS, HORIZONS, type DecisionHorizon, type WeightVector } from "./types.js";
import { validateWeights } from "./engine.js";

interface WeightSetRow {
  id: number;
  horizon: string;
  weights_json: string;
  is_active: number;
  note: string | null;
  created_at: string;
}

function parseWeights(json: string): WeightVector {
  const parsed = JSON.parse(json) as Partial<Record<string, number>>;
  const out = {} as WeightVector;
  for (const f of FACTORS) out[f] = parsed[f] ?? 0;
  return out;
}

async function seedHorizon(env: Env, horizon: DecisionHorizon): Promise<WeightVector> {
  const weights = DEFAULT_WEIGHTS[horizon];
  await env.DB.prepare(
    `INSERT INTO decision_weight_sets (horizon, weights_json, is_active, note) VALUES (?, ?, 1, ?)`
  )
    .bind(horizon, JSON.stringify(weights), "seeded from DEFAULT_WEIGHTS on first use")
    .run();
  return weights;
}

/** Reads the single active weight vector for one horizon, lazily seeding
 *  from DEFAULT_WEIGHTS the first time this horizon is ever requested
 *  (so a fresh D1 doesn't need a manual setup step before /decide works). */
export async function getActiveWeights(env: Env, horizon: DecisionHorizon): Promise<WeightVector> {
  const row = await env.DB.prepare(
    `SELECT * FROM decision_weight_sets WHERE horizon = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1`
  )
    .bind(horizon)
    .first<WeightSetRow>();
  if (!row) return seedHorizon(env, horizon);
  return parseWeights(row.weights_json);
}

export async function getAllActiveWeights(env: Env): Promise<Record<DecisionHorizon, WeightVector>> {
  const entries = await Promise.all(HORIZONS.map(async (h) => [h, await getActiveWeights(env, h)] as const));
  return Object.fromEntries(entries) as Record<DecisionHorizon, WeightVector>;
}

/** Reads the recent weight-set history for one horizon (active + prior),
 *  most recent first -- powers the tuning history view on /decision-lab. */
export async function getWeightHistory(env: Env, horizon: DecisionHorizon, limit = 20) {
  const { results } = await env.DB.prepare(
    `SELECT id, horizon, weights_json, is_active, note, created_at FROM decision_weight_sets
     WHERE horizon = ? ORDER BY created_at DESC LIMIT ?`
  )
    .bind(horizon, limit)
    .all<WeightSetRow>();
  return (results ?? []).map((r) => ({
    id: r.id,
    horizon: r.horizon,
    weights: parseWeights(r.weights_json),
    isActive: r.is_active === 1,
    note: r.note,
    createdAt: r.created_at,
  }));
}

/** Validates, then inserts a new active row for `horizon` and deactivates
 *  every previous row -- the only write path for weights (no in-place
 *  UPDATE), so /decision-lab's tuning history is always complete. Throws
 *  on invalid weights rather than silently clamping/renormalizing; the
 *  caller (POST /weights in index.ts) is expected to surface that as a
 *  400, not write bad weights and hope evaluateHorizon degrades gracefully. */
export async function setActiveWeights(env: Env, horizon: DecisionHorizon, weights: WeightVector, note?: string): Promise<void> {
  const error = validateWeights(weights);
  if (error) throw new Error(error);
  await env.DB.batch([
    env.DB.prepare(`UPDATE decision_weight_sets SET is_active = 0 WHERE horizon = ? AND is_active = 1`).bind(horizon),
    env.DB.prepare(`INSERT INTO decision_weight_sets (horizon, weights_json, is_active, note) VALUES (?, ?, 1, ?)`).bind(
      horizon,
      JSON.stringify(weights),
      note ?? null
    ),
  ]);
}
