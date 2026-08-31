// Decision engine core -- a close TypeScript port of the uploaded
// stock_algorithm.py's StockDecisionAlgorithm. Ported behavior, not just
// shape: same weighted-average score, same confidence-via-dispersion
// (NOT another weighted score -- it measures how internally consistent
// the 10 factor readings are, high dispersion is uncertainty, not
// automatically bullish/bearish), same decision thresholds, same
// strengths/weaknesses cutoffs (>=75 / <=40), same warnings logic.

import { DEFAULT_THRESHOLDS, FACTORS, type Factor, type FactorScores, type HorizonResult, type ValuationMetrics, type WeightVector } from "./types.js";

export function validateWeights(weights: WeightVector): string | null {
  const missing = FACTORS.filter((f) => !(f in weights));
  if (missing.length > 0) return `missing weights: ${missing.join(", ")}`;
  if (FACTORS.some((f) => weights[f] < 0)) return "weights cannot be negative";
  const total = FACTORS.reduce((a, f) => a + weights[f], 0);
  if (Math.abs(total - 1) > 1e-6) return `weights must sum to 1.0; got ${total.toFixed(4)}`;
  return null;
}

export function validateScores(scores: FactorScores): string | null {
  for (const f of FACTORS) {
    const v = scores[f];
    if (v === undefined || v === null) return `missing factor score: ${f}`;
    if (!(v >= 0 && v <= 100)) return `${f}: score must be between 0 and 100; got ${v}`;
  }
  return null;
}

/** Simple transparent weighted average, renormalizing the given weight
 *  vector to sum to 1 first (mirrors weighted_score() in the Python
 *  original, which is also used standalone for sensitivity analysis). */
export function weightedScore(scores: FactorScores, weights: WeightVector): number {
  const totalWeight = FACTORS.reduce((a, f) => a + (weights[f] ?? 0), 0);
  if (totalWeight <= 0) throw new Error("Weight sum must be positive.");
  return FACTORS.reduce((a, f) => a + scores[f] * ((weights[f] ?? 0) / totalWeight), 0);
}

/** Nudges one factor's weight by `delta` and proportionally rescales the
 *  rest so the vector still sums to 1 -- used for the sensitivity table.
 *  Returns null (not a throw) if the perturbation would push the target
 *  factor's weight negative, e.g. nudging a 0.03 weight by -0.05 -- a
 *  real, expected case for small weights, not a bug. Callers must handle
 *  null rather than assume every perturbation succeeds (the original
 *  Python example script's crash-on-None was exactly this case going
 *  unhandled at the print layer, not a bug in this function). */
export function perturbWeights(weights: WeightVector, factor: Factor, delta: number): WeightVector | null {
  const newValue = weights[factor] + delta;
  if (newValue < 0) return null;

  const oldRemaining = 1 - weights[factor];
  const newRemaining = 1 - newValue;
  const out = { ...weights, [factor]: newValue };
  if (oldRemaining <= 0) return out;
  for (const f of FACTORS) {
    if (f !== factor) out[f] = (weights[f] / oldRemaining) * newRemaining;
  }
  return out;
}

export interface SensitivityRow {
  base: number;
  minus: number | null;
  plus: number | null;
}

export function sensitivityTable(scores: FactorScores, weights: WeightVector, delta = 0.05): Record<Factor, SensitivityRow> {
  const base = weightedScore(scores, weights);
  const out = {} as Record<Factor, SensitivityRow>;
  for (const factor of FACTORS) {
    const minusW = perturbWeights(weights, factor, -delta);
    const plusW = perturbWeights(weights, factor, +delta);
    out[factor] = {
      base,
      minus: minusW ? weightedScore(scores, minusW) : null,
      plus: plusW ? weightedScore(scores, plusW) : null,
    };
  }
  return out;
}

function decisionLabel(score: number, thresholds = DEFAULT_THRESHOLDS): string {
  if (score >= thresholds.strong_buy) return "STRONG BUY";
  if (score >= thresholds.buy) return "BUY";
  if (score >= thresholds.accumulate) return "ACCUMULATE";
  if (score >= thresholds.hold) return "HOLD / WAIT";
  if (score >= thresholds.reduce) return "REDUCE";
  if (score >= thresholds.sell) return "SELL";
  return "STRONG SELL";
}

/** Raw price/fair-value ratio classification -- distinct from, and not to
 *  be confused with, the "valuation" FACTOR score used in weighting (see
 *  factors.ts), exactly as the original Python keeps valuation_status()
 *  separate from the caller-supplied valuation factor input. */
export function valuationStatus(currentPrice: number | null, fairValue: number | null): string {
  if (currentPrice === null || fairValue === null || fairValue <= 0) return "UNKNOWN";
  const ratio = currentPrice / fairValue;
  if (ratio <= 0.7) return "DEEPLY_UNDERVALUED";
  if (ratio <= 0.85) return "UNDERVALUED";
  if (ratio <= 1.05) return "FAIRLY_VALUED";
  if (ratio <= 1.25) return "EXPENSIVE";
  return "VERY_EXPENSIVE";
}

export function entryStatus(entryScore: number): string {
  if (entryScore >= 85) return "EXCELLENT_ENTRY";
  if (entryScore >= 70) return "GOOD_ENTRY";
  if (entryScore >= 55) return "NEUTRAL_ENTRY";
  if (entryScore >= 40) return "WEAK_ENTRY";
  return "POOR_ENTRY";
}

export function valuationMetrics(
  currentPrice: number | null,
  fairValue: number | null,
  expectedPrice: number | null,
  downsidePrice: number | null
): ValuationMetrics {
  const result: ValuationMetrics = {
    fairValueUpside: null,
    marginOfSafety: null,
    expectedReturn: null,
    downside: null,
    riskReward: null,
  };
  if (currentPrice === null || currentPrice <= 0) return result;

  if (fairValue !== null && fairValue > 0) {
    result.fairValueUpside = fairValue / currentPrice - 1;
    result.marginOfSafety = 1 - currentPrice / fairValue;
  }
  if (expectedPrice !== null) result.expectedReturn = expectedPrice / currentPrice - 1;
  if (downsidePrice !== null) result.downside = 1 - downsidePrice / currentPrice;
  if (result.expectedReturn !== null && result.downside !== null && result.downside > 0) {
    result.riskReward = result.expectedReturn / result.downside;
  }
  return result;
}

function stddev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function evaluateHorizon(
  horizon: HorizonResult["horizon"],
  scores: FactorScores,
  weights: WeightVector,
  currentPrice: number | null,
  fairValue: number | null,
  thresholds = DEFAULT_THRESHOLDS
): HorizonResult {
  const contribution = {} as Record<Factor, number>;
  for (const f of FACTORS) contribution[f] = Math.round(scores[f] * weights[f] * 1000) / 1000;
  const rawScore = FACTORS.reduce((a, f) => a + contribution[f], 0);

  // Confidence is deliberately NOT another weighted score -- it measures
  // consistency of the factor evidence via dispersion, exactly as in the
  // Python original.
  const values = FACTORS.map((f) => scores[f]);
  const confidence = Math.max(0, Math.min(100, 100 - stddev(values)));

  const strengths = FACTORS.filter((f) => scores[f] >= 75);
  const weaknesses = FACTORS.filter((f) => scores[f] <= 40);

  return {
    horizon,
    score: Math.round(rawScore * 100) / 100,
    decision: decisionLabel(rawScore, thresholds),
    confidence: Math.round(confidence * 100) / 100,
    factorContribution: contribution,
    strengths,
    weaknesses,
    valuationStatus: valuationStatus(currentPrice, fairValue),
    entryStatus: entryStatus(scores.entry),
  };
}

export function overallView(results: Record<string, HorizonResult>): string {
  const scores = Object.values(results).map((r) => r.score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg >= 80) return "BROADLY BULLISH";
  if (avg >= 65) return "BULLISH";
  if (avg >= 50) return "MIXED / SELECTIVE";
  if (avg >= 35) return "BEARISH";
  return "BROADLY BEARISH";
}

export function buildWarnings(
  scores: FactorScores,
  valuation: ValuationMetrics,
  results: Record<"short" | "medium" | "long", HorizonResult>
): string[] {
  const warnings: string[] = [];
  if (valuation.fairValueUpside !== null && valuation.fairValueUpside < 0) {
    warnings.push("Price is above estimated fair value.");
  }
  if (scores.risk < 40) warnings.push("Risk score is weak.");
  if (scores.financial_strength < 40) warnings.push("Financial-strength score is weak.");
  if (scores.valuation < 40) warnings.push("Valuation score is weak.");
  if (scores.entry < 40) warnings.push("Current entry score is poor.");
  if (results.short.score - results.long.score >= 20) {
    warnings.push("Short-term setup is materially stronger than the long-term thesis.");
  }
  if (results.long.score - results.short.score >= 20) {
    warnings.push("Long-term thesis is materially stronger than the current short-term setup.");
  }
  return warnings;
}
