// Orchestration for the decision engine: pulls the same universe snapshot
// the v1 rankings engine uses (see scoring/run.ts, which is expected to
// have already run in the same scheduled/manual trigger and refreshed
// technical_snapshot -- this module does NOT recompute indicators itself,
// to avoid doing that work twice per run), computes the market-regime
// proxy once, scores every ticker across all three horizons, and persists
// the results into the `decisions` table (migration 0005).

import { getUniverseSnapshot, insertDecisionsBatch, type DecisionRow } from "../lib/db.js";
import { fetchChart } from "../lib/yahoo.js";
import { parsePriceHistory } from "../lib/parse.js";
import { computeIndicators } from "../scoring/indicators.js";
import { computeFactorScores, computeSupportingMetrics, marketRegimeFromIndicators, neutralMarketRegime, toFactorScores } from "./factors.js";
import { buildWarnings, evaluateHorizon, overallView, valuationMetrics } from "./engine.js";
import { getAllActiveWeights } from "./weights.js";
import { HORIZONS, type DecisionHorizon, type FactorScoreDetail, type HorizonResult } from "./types.js";
import type { Env } from "../lib/types.js";

export interface DecisionSummary {
  tickersDecided: number;
  decisionsWritten: number;
  marketRegime: FactorScoreDetail;
}

// SPY as the market-regime proxy: a broad, liquid US index ETF available
// on the same Yahoo Finance chart endpoint already used for every other
// ticker (lib/yahoo.ts) -- no new data source, no new ingestion path.
// Deliberately NOT added to config/universe.json: fetched fresh, in
// memory, once per decision run, and never written to price_history or
// stocks, so it can't affect the v1 dashboard's ticker counts or lists.
const MARKET_REGIME_PROXY_TICKER = "SPY";

async function computeMarketRegime(): Promise<FactorScoreDetail> {
  try {
    const resp = await fetchChart(MARKET_REGIME_PROXY_TICKER, "1y", "1d");
    if (!resp.ok || !resp.data) {
      return neutralMarketRegime(`market-regime proxy fetch (${MARKET_REGIME_PROXY_TICKER}) failed: ${resp.error ?? `HTTP ${resp.status}`}`);
    }
    const bars = parsePriceHistory(resp.data);
    const points = bars.filter((b) => b.close !== null).map((b) => ({ date: b.date, close: b.close as number, volume: b.volume }));
    if (points.length < 30) {
      return neutralMarketRegime(`market-regime proxy (${MARKET_REGIME_PROXY_TICKER}) returned too little history`);
    }
    const indicators = computeIndicators(points);
    return marketRegimeFromIndicators(indicators);
  } catch (err) {
    return neutralMarketRegime(`market-regime proxy computation threw: ${(err as Error).message}`);
  }
}

/** Runs the decision engine over the current universe snapshot and
 *  persists one row per (ticker, horizon) into `decisions`. Safe to call
 *  on its own against whatever's already in D1 -- like runScoring, this
 *  doesn't re-fetch from Yahoo for individual tickers, only for the one
 *  market-regime proxy. */
export async function runDecisions(env: Env): Promise<DecisionSummary> {
  const [snapshot, weights, marketRegime] = await Promise.all([
    getUniverseSnapshot(env),
    getAllActiveWeights(env),
    computeMarketRegime(),
  ]);

  const runAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  const rows: DecisionRow[] = [];
  let tickersDecided = 0;

  for (const row of snapshot) {
    if (row.price === null) continue; // can't compute valuation/entry status without a current price

    const details = computeFactorScores(row, marketRegime);
    const scores = toFactorScores(details);
    const valuation = valuationMetrics(row.price, row.fair_value, null, null);

    const results = Object.fromEntries(
      HORIZONS.map((h) => [h, evaluateHorizon(h, scores, weights[h], row.price, row.fair_value)])
    ) as Record<DecisionHorizon, HorizonResult>;

    const warnings = buildWarnings(scores, valuation, results);
    const unscoredNote = Object.entries(details)
      .filter(([, d]) => (d as FactorScoreDetail).unscored)
      .map(([f]) => f);
    if (unscoredNote.length > 0) warnings.push(`Placeholder/unscored factors used: ${unscoredNote.join(", ")}.`);

    const supportingMetricsJson = JSON.stringify(computeSupportingMetrics(row));

    tickersDecided++;
    for (const horizon of HORIZONS) {
      const r = results[horizon];
      rows.push({
        runAt,
        ticker: row.ticker,
        horizon,
        score: r.score,
        decision: r.decision,
        confidence: r.confidence,
        valuationStatus: r.valuationStatus,
        entryStatus: r.entryStatus,
        factorScoresJson: JSON.stringify(scores),
        factorContributionJson: JSON.stringify(r.factorContribution),
        warningsJson: JSON.stringify(horizon === "long" ? [...warnings, `Overall view: ${overallView(results)}`] : warnings),
        supportingMetricsJson,
      });
    }
  }

  await insertDecisionsBatch(env, rows, runAt);

  return { tickersDecided, decisionsWritten: rows.length, marketRegime };
}
