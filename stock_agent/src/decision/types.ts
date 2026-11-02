// Types and default constants for the second, independent decision engine
// (src/decision/*). This is a TypeScript port of an uploaded Python
// prototype ("V1 Weight Philosophy" / "V1 Specification") that scores a
// stock across 10 named factors and produces a per-horizon BUY/SELL-style
// decision -- a different design from the existing self-relative
// valuation/quality/entryTiming engine in src/scoring/score.ts, run
// alongside it (not replacing it) per an explicit choice to compare the two.
//
// Deliberately kept in its own module tree, its own DB tables (migration
// 0005), its own dashboard page (src/decisionLab.ts), and its own horizon
// naming ("medium", not "mid") so the two systems never silently blend.

export const FACTORS = [
  "quality",
  "growth",
  "financial_strength",
  "valuation",
  "future_potential",
  "technical",
  "entry",
  "risk",
  "catalyst",
  "market_regime",
] as const;

export type Factor = (typeof FACTORS)[number];

export const HORIZONS = ["short", "medium", "long"] as const;
export type DecisionHorizon = (typeof HORIZONS)[number];

export type WeightVector = Record<Factor, number>;
export type FactorScores = Record<Factor, number>;

/** Per-factor 0-100 score plus whether it's a real computation or a
 *  placeholder (see src/decision/factors.ts) -- surfaced in the API/UI so
 *  an unscored factor is never mistaken for real signal. */
export interface FactorScoreDetail {
  value: number;
  unscored: boolean;
  note?: string;
}

export type FactorScoreDetails = Record<Factor, FactorScoreDetail>;

/** Ported verbatim (structure and reasoning) from the uploaded
 *  stock_algorithm.py DEFAULT_WEIGHTS -- these are the seed values written
 *  into decision_weight_sets on first use, not hardcoded at scoring time.
 *  Once seeded, the live weights in D1 (via /weights) are what's actually
 *  used; these are only the starting point. Each horizon sums to 1.00. */
export const DEFAULT_WEIGHTS: Record<DecisionHorizon, WeightVector> = {
  short: {
    quality: 0.08,
    growth: 0.07,
    financial_strength: 0.05,
    valuation: 0.08,
    future_potential: 0.08,
    technical: 0.18,
    entry: 0.22,
    risk: 0.1,
    catalyst: 0.1,
    market_regime: 0.04,
  },
  medium: {
    quality: 0.13,
    growth: 0.14,
    financial_strength: 0.09,
    valuation: 0.14,
    future_potential: 0.1,
    technical: 0.1,
    entry: 0.1,
    risk: 0.07,
    catalyst: 0.07,
    market_regime: 0.06,
  },
  long: {
    quality: 0.19,
    growth: 0.19,
    financial_strength: 0.14,
    valuation: 0.17,
    future_potential: 0.1,
    technical: 0.03,
    entry: 0.04,
    risk: 0.07,
    catalyst: 0.02,
    market_regime: 0.05,
  },
};

/** Ported verbatim from DEFAULT_THRESHOLDS in stock_algorithm.py. Kept as
 *  code constants for now (not D1-backed like the weights) -- the request
 *  that triggered this system was specifically about weights being
 *  data-driven; thresholds can move to D1 too later if that turns out to
 *  matter as much. */
export const DEFAULT_THRESHOLDS = {
  strong_buy: 85,
  buy: 75,
  accumulate: 65,
  hold: 50,
  reduce: 40,
  sell: 25,
};

export interface HorizonResult {
  horizon: DecisionHorizon;
  score: number;
  decision: string;
  confidence: number;
  factorContribution: Record<Factor, number>;
  strengths: Factor[];
  weaknesses: Factor[];
  valuationStatus: string;
  entryStatus: string;
}

export interface ValuationMetrics {
  fairValueUpside: number | null;
  marginOfSafety: number | null;
  expectedReturn: number | null;
  downside: number | null;
  riskReward: number | null;
}
