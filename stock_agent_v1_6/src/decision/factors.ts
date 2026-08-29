// Raw data -> the 10 normalized 0-100 factor scores this decision engine
// consumes (see types.ts FACTORS). The uploaded V1_SPECIFICATION.md is
// explicit that "raw data is intentionally outside this first version" --
// factor computation is this project's own work, not ported from Python.
//
// Reuses the existing getUniverseSnapshot() row shape (src/lib/db.ts) as
// its only per-ticker input, rather than adding new queries -- same
// fundamentals/valuation/technical snapshot the existing rankings engine
// (src/scoring/score.ts) already reads, extended (migration 0006) with a
// few more columns for EV/EBIT, Net Debt/EBITDA, interest coverage, Beta,
// ROA, and analyst-recommendation counts, plus pulling the pre-existing
// payout_ratio column into this join for the first time. The v1 rankings
// engine ignores the new/newly-joined columns entirely, so this doesn't
// change its behavior.
//
// Two factors have no real data source yet, per the user's instruction to
// design for improvement rather than fake them with invented numbers:
//   - market_regime: a real (if simple) computation IS attempted, from a
//     live market-index proxy fetched fresh per scoring run (see
//     computeMarketRegime below) -- not stored in config/universe.json or
//     the stocks/price_history tables, so it can never change the existing
//     v1 dashboard's ticker counts or rankings.
//   - catalyst: stubbed neutral (50) and flagged `unscored: true`. There is
//     no news/events/earnings-calendar data source in this project at all
//     YET (Yahoo Finance chart+quoteSummary only) -- inventing a number
//     here would be indistinguishable from real signal once it's in a
//     weighted average, so it stays an honest, clearly-flagged placeholder
//     until a real source is wired in. This is a current-version gap, not
//     a design decision to exclude it permanently -- a real read would
//     need a news/events source to be scraped and analyzed (earnings
//     dates, guidance changes, M&A, regulatory action, etc.), which is
//     future-version scope, not a small addition.
// Every factor score is returned as a FactorScoreDetail (value + unscored)
// specifically so the UI and warnings can tell a placeholder from a real
// read, not just see a 50.

import type { UniverseSnapshotRow } from "../lib/db.js";
import type { TechnicalIndicators } from "../scoring/indicators.js";
import type { Factor, FactorScoreDetail, FactorScoreDetails } from "./types.js";

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Linear interpolation between "weak" (0) and "strong" (100), clamped
 *  outside that range -- same shape as scoring/score.ts's bandScore, kept
 *  as its own copy here rather than a shared import since this engine's
 *  bands are independently tunable and shouldn't move if the v1 rankings
 *  engine's bands are retuned (or vice versa). */
function band(value: number | null, weak: number, strong: number, higherIsBetter = true): number | null {
  if (value === null) return null;
  const t = higherIsBetter ? (value - weak) / (strong - weak) : (weak - value) / (weak - strong);
  return clamp(t, 0, 1) * 100;
}

function avg(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

const NEUTRAL = 50;

// --- Derived ratios (EV/EBIT, Net Debt/EBITDA, interest coverage) -------
// Stored raw in D1 (migration 0006), derived here at read time -- same
// convention as the existing valuation-gap-vs-fair-value calculation.
// Exported (not just used internally) so they can feed both the factor
// scores below AND the supporting-metrics display block, from one
// definition, and so they're directly unit-testable.

/** Enterprise value / EBIT (operating income) -- what the user specifically
 *  asked for as a cross-check against P/E: EV/EBIT isn't distorted by a
 *  company's capital structure or tax rate the way P/E can be. Null when
 *  EBIT is missing or non-positive (a negative or zero EBIT makes the
 *  ratio meaningless, not just "expensive"). */
export function computeEvToEbit(enterpriseValue: number | null, ebit: number | null): number | null {
  if (enterpriseValue === null || ebit === null || ebit <= 0) return null;
  return enterpriseValue / ebit;
}

/** (Total debt - total cash) / EBITDA -- leverage relative to cash-flow
 *  generation, not just a balance-sheet ratio like debt-to-equity. Null
 *  when EBITDA is missing or non-positive. Can be negative (net cash
 *  position), which is a valid, better-than-zero reading. */
export function computeNetDebtToEbitda(totalDebt: number | null, totalCash: number | null, ebitda: number | null): number | null {
  if (totalDebt === null || totalCash === null || ebitda === null || ebitda <= 0) return null;
  return (totalDebt - totalCash) / ebitda;
}

/** EBIT / interest expense -- can this company comfortably service its
 *  debt from operating earnings. Null when either input is missing, or
 *  interest expense is non-positive (treated as missing data here, not as
 *  "zero debt cost", since this project can't yet tell the two apart from
 *  what Yahoo returns). */
export function computeInterestCoverage(ebit: number | null, interestExpense: number | null): number | null {
  if (ebit === null || interestExpense === null || interestExpense <= 0) return null;
  return ebit / interestExpense;
}

function detail(value: number | null, note?: string): FactorScoreDetail {
  if (value === null) return { value: NEUTRAL, unscored: true, note: note ?? "no data available for this ticker" };
  return { value: Math.round(value * 10) / 10, unscored: false };
}

/** Business quality: profitability + capital efficiency, fixed absolute
 *  bands (same underlying metrics and bands as scoring/score.ts's
 *  qualityVerdict, since both are answering "is this a good business" from
 *  the same fundamentals_snapshot columns -- no reason to disagree here). */
function scoreQuality(row: UniverseSnapshotRow): FactorScoreDetail {
  const points = [
    band(row.gross_margin, 0.2, 0.6),
    band(row.operating_margin, 0.05, 0.3),
    band(row.net_margin, 0.03, 0.25),
    band(row.return_on_equity, 0.08, 0.3),
    // ROA complements ROE: ROE alone rewards leverage (a highly-indebted
    // company can post a high ROE on a thin equity base), ROA measures
    // profitability against ALL assets, debt-funded or not.
    band(row.return_on_assets, 0.03, 0.15),
  ];
  return detail(avg(points), "insufficient fundamentals data (margins/ROE/ROA)");
}

/** Historical/recent growth -- revenue and earnings YoY, banded 0%..25%
 *  (wider top band than the v1 rankings engine's growth-style classifier,
 *  since here growth is a standalone factor rather than a binary
 *  growth/defensive style tag). */
function scoreGrowth(row: UniverseSnapshotRow): FactorScoreDetail {
  const points = [band(row.revenue_growth_yoy, 0, 0.25), band(row.earnings_growth_yoy, 0, 0.25)];
  return detail(avg(points), "insufficient growth data (revenue/earnings YoY)");
}

/** Balance sheet + cash generation resilience: low leverage (both against
 *  equity and against actual cash-flow generation), real free cash flow
 *  yield, and can earnings comfortably cover interest payments. */
function scoreFinancialStrength(row: UniverseSnapshotRow): FactorScoreDetail {
  const netDebtToEbitda = computeNetDebtToEbitda(row.total_debt, row.total_cash, row.ebitda);
  const interestCoverage = computeInterestCoverage(row.ebit, row.interest_expense);
  const points = [
    band(row.debt_to_equity, 2.5, 0.3, false),
    band(row.fcf_yield, 0, 0.06),
    // Net Debt/EBITDA: leverage relative to cash-flow generation, not just
    // a balance-sheet ratio. ~4x+ is stretched, ~0x or net-cash is strong.
    netDebtToEbitda === null ? null : band(netDebtToEbitda, 4, 0, false),
    // Interest coverage: EBIT / interest expense. Below ~2x is a red flag,
    // above ~8x is comfortable.
    interestCoverage === null ? null : band(interestCoverage, 2, 8),
  ];
  return detail(avg(points), "insufficient balance-sheet/cash-flow data");
}

/** Relative/intrinsic valuation attractiveness -- same two self-relative
 *  signals as scoring/score.ts's valuationVerdict (own-range percentile +
 *  analyst fair-value gap), rescaled to 0-100 here. Deliberately distinct
 *  from valuationStatus() in engine.ts, which classifies the raw
 *  price/fair-value ratio rather than feeding the weighted average -- see
 *  the comment on valuationStatus. */
function scoreValuation(row: UniverseSnapshotRow): FactorScoreDetail {
  const gapPct = row.price !== null && row.fair_value ? (row.price - row.fair_value) / row.fair_value : null;
  const rangeSignal = row.price_range_pct === null ? null : 1 - 2 * row.price_range_pct; // 1 = at own low
  const gapSignal = gapPct === null ? null : clamp(-gapPct / 0.25, -1, 1); // 25% below fair value -> +1
  const combined = avg([rangeSignal, gapSignal]);

  // EV/EBIT as a third, independent valuation cross-check: unlike the two
  // signals above (both self-relative, comparing this ticker to its own
  // history/estimate), EV/EBIT is an absolute multiple -- and unlike P/E,
  // it isn't distorted by capital structure or tax rate, which is exactly
  // why it's worth including alongside P/E rather than instead of it (P/E
  // itself isn't scored here, but is shown next to it on the card).
  const evToEbit = computeEvToEbit(row.enterprise_value, row.ebit);
  const evToEbitSignal = evToEbit === null ? null : (band(evToEbit, 30, 8, false) as number) / 100; // -> 0..1

  if (combined === null && evToEbitSignal === null) {
    return detail(null, "no valuation data (price range / fair value / EV-EBIT all missing)");
  }
  const selfRelative = combined === null ? null : (combined + 1) / 2; // -> 0..1
  const overall = avg([selfRelative, evToEbitSignal]);
  return detail(overall === null ? null : overall * 100);
}

/** Structural/forward growth potential -- a proxy, not a real TAM or
 *  reinvestment-runway estimate (this project has no data source for
 *  either). Built from PEG ratio (growth priced in relative to what you
 *  pay -- lower is more room to run) and analyst coverage breadth as a
 *  rough confidence signal on the growth read. Weaker evidentiary basis
 *  than the other fundamentals-backed factors; not flagged `unscored`
 *  because it IS a real computation from real data, just an acknowledged
 *  proxy for what the spec actually asks for. */
function scoreFuturePotential(row: UniverseSnapshotRow): FactorScoreDetail {
  const pegScore = row.peg_ratio === null || row.peg_ratio <= 0 ? null : band(row.peg_ratio, 3, 0.75, false);
  const coverageScore = row.num_analysts === null ? null : band(row.num_analysts, 1, 12);
  const points = [pegScore, coverageScore];
  return detail(avg(points), "insufficient data for a future-potential proxy (PEG / analyst coverage)");
}

/** Trend, momentum, relative strength, market structure -- from the
 *  already-computed technical_snapshot columns (indicators.ts). RSI
 *  contributes as an absolute overbought/oversold read (neutral RSI
 *  scores highest), MACD as a binary bullish/bearish cross, price vs its
 *  own 50d/200d averages as trend confirmation. */
function scoreTechnical(row: UniverseSnapshotRow): FactorScoreDetail {
  const rsiScore = row.rsi_14 === null ? null : (1 - Math.abs(row.rsi_14 - 50) / 50) * 100;
  const macdScore = row.macd === null || row.macd_signal === null ? null : row.macd > row.macd_signal ? 70 : 30;
  const sma50Score = row.price_vs_sma50 === null ? null : band(row.price_vs_sma50, -0.1, 0.1);
  const sma200Score = row.price_vs_sma200 === null ? null : band(row.price_vs_sma200, -0.15, 0.15);
  const points = [rsiScore, macdScore, sma50Score, sma200Score];
  return detail(avg(points), "insufficient technical-indicator data");
}

/** Quality of the current purchase point -- reuses the same trend_state
 *  read as scoring/score.ts's entryTimingVerdict (itself purely a
 *  function of this ticker's own price series). */
function scoreEntry(row: UniverseSnapshotRow): FactorScoreDetail {
  const stateScore: Record<string, number> = {
    pullback_in_uptrend: 80,
    neutral: 50,
    near_historical_highs: 30,
    downtrend: 20,
  };
  const rsiScore = row.rsi_14 === null ? null : 1 - Math.abs(row.rsi_14 - 50) / 50;
  if (row.trend_state === null || !(row.trend_state in stateScore)) {
    if (rsiScore === null) return detail(null, "insufficient price-history data for entry timing");
    return detail(rsiScore * 100);
  }
  const base = stateScore[row.trend_state] as number;
  const combined = rsiScore === null ? base : base * 0.7 + rsiScore * 100 * 0.3;
  return detail(combined);
}

/** Downside/volatility/leverage risk -- higher score = LOWER risk (0-100
 *  is "excellent" like every other factor here), from 30d volatility,
 *  leverage, and how far price sits from its own multi-year high (deep
 *  drawdown from highs is itself a risk signal, distinct from the entry
 *  factor's "is a pullback a buying opportunity" read). */
function scoreRisk(row: UniverseSnapshotRow): FactorScoreDetail {
  const volScore = row.volatility_30d === null ? null : band(row.volatility_30d, 0.6, 0.15, false);
  const leverageScore = row.debt_to_equity === null ? null : band(row.debt_to_equity, 3, 0.5, false);
  const drawdownScore = row.dist_from_high_pct === null ? null : band(row.dist_from_high_pct, -0.6, -0.05, true);
  // Beta: volatility relative to the broader market, distinct from this
  // ticker's own (absolute) volatility above -- a stock can be internally
  // calm but still swing hard with the market (high beta), or the reverse.
  const betaScore = row.beta === null ? null : band(row.beta, 2.0, 0.5, false);
  const points = [volScore, leverageScore, drawdownScore, betaScore];
  return detail(avg(points), "insufficient volatility/leverage/drawdown/beta data");
}

/** No news/events/earnings-calendar data source exists in this project YET
 *  (Yahoo Finance chart+quoteSummary only, see lib/yahoo.ts) -- for now this
 *  is a clearly-flagged neutral placeholder rather than a fabricated
 *  number. This is a current-version limitation, not a permanent one: a
 *  real read would need a news/events source to be scraped and analyzed
 *  (earnings dates, guidance changes, M&A, regulatory action, etc.) and is
 *  a reasonable candidate for a future version. Kept as its own function
 *  (not inlined) so that future real implementation has one obvious place
 *  to land. */
function scoreCatalyst(): FactorScoreDetail {
  return { value: NEUTRAL, unscored: true, note: "no news/events data source yet in this version -- neutral placeholder" };
}

/** Broader market/sector conditions -- NOT derived from this ticker's own
 *  data at all (that would just double-count `technical`). Computed once
 *  per scoring run from a market-index proxy and passed in here; see
 *  computeMarketRegime below for how that read is produced. */
function scoreMarketRegime(regime: FactorScoreDetail): FactorScoreDetail {
  return regime;
}

export function computeFactorScores(row: UniverseSnapshotRow, marketRegime: FactorScoreDetail): FactorScoreDetails {
  const out: Partial<FactorScoreDetails> = {
    quality: scoreQuality(row),
    growth: scoreGrowth(row),
    financial_strength: scoreFinancialStrength(row),
    valuation: scoreValuation(row),
    future_potential: scoreFuturePotential(row),
    technical: scoreTechnical(row),
    entry: scoreEntry(row),
    risk: scoreRisk(row),
    catalyst: scoreCatalyst(),
    market_regime: scoreMarketRegime(marketRegime),
  };
  return out as FactorScoreDetails;
}

/** Simple 0-100 read on overall market trend, from ONE proxy index
 *  ticker's own recent price action -- same trend-state logic as a single
 *  stock's entry timing (price vs its 50d/200d averages), applied to the
 *  index instead. Computed fresh, in-memory, once per scoring run (not
 *  per ticker, not persisted, not added to config/universe.json or the
 *  stocks/price_history tables) specifically so it can never change the
 *  existing v1 dashboard's ticker counts, growth/defensive lists, or
 *  rankings. Falls back to a flagged-neutral placeholder if the proxy
 *  fetch fails or returns too little history -- this is explicitly the
 *  factor the user asked to be "tuned and adjusted for the future," so a
 *  real (if simple) computation is attempted here rather than skipped. */
export function marketRegimeFromIndicators(indicators: TechnicalIndicators): FactorScoreDetail {
  const sma50Score = indicators.priceVsSma50 === null ? null : band(indicators.priceVsSma50, -0.08, 0.08);
  const sma200Score = indicators.priceVsSma200 === null ? null : band(indicators.priceVsSma200, -0.12, 0.12);
  const rsiScore = indicators.rsi14 === null ? null : (1 - Math.abs(indicators.rsi14 - 50) / 50) * 100;
  const points = [sma50Score, sma200Score, rsiScore];
  const value = avg(points);
  if (value === null) {
    return { value: NEUTRAL, unscored: true, note: "market-regime proxy fetch returned insufficient price history" };
  }
  return { value: Math.round(value * 10) / 10, unscored: false, note: "computed from SPY trend/momentum" };
}

export function neutralMarketRegime(note: string): FactorScoreDetail {
  return { value: NEUTRAL, unscored: true, note };
}

/** Plain 0-100 map for persistence (factor_scores_json) -- FactorScores is
 *  what engine.ts's weightedScore/evaluateHorizon actually consume. */
export function toFactorScores(details: FactorScoreDetails): Record<Factor, number> {
  const out = {} as Record<Factor, number>;
  for (const [k, v] of Object.entries(details) as Array<[Factor, FactorScoreDetail]>) out[k] = v.value;
  return out;
}

/** The raw numbers behind EV/EBIT, Net Debt/EBITDA, interest coverage,
 *  Beta, ROA, plus the analyst recommendation/target-price spread --
 *  persisted alongside each decision (supporting_metrics_json, migration
 *  0006) so the card can show the underlying evidence, not just the
 *  abstracted 0-100 factor score it fed into. None of this is re-derived
 *  or re-scored here; it's a display-only snapshot of what
 *  computeFactorScores already used (plus P/E and EV/EBITDA, which aren't
 *  scored at all, for a direct side-by-side against EV/EBIT). */
export interface SupportingMetrics {
  currentPrice: number | null;
  trailingPe: number | null;
  evToEbitda: number | null;
  evToEbit: number | null;
  netDebtToEbitda: number | null;
  interestCoverage: number | null;
  beta: number | null;
  returnOnAssets: number | null;
  // Dividend-sustainability cross-check, not blended into any factor score
  // (unlike EV/EBIT etc.): a high payout ratio isn't automatically bad
  // (mature, stable-cash-flow businesses often run high payout), so it
  // doesn't map cleanly onto a single "higher is better/worse" band the
  // way leverage or coverage ratios do -- shown for the reader to weigh
  // in context, same treatment as the analyst data below.
  payoutRatio: number | null;
  analyst: {
    numAnalysts: number | null;
    rating: string | null;
    targetLow: number | null;
    targetMean: number | null;
    targetHigh: number | null;
    recStrongBuy: number | null;
    recBuy: number | null;
    recHold: number | null;
    recSell: number | null;
    recStrongSell: number | null;
  };
}

export function computeSupportingMetrics(row: UniverseSnapshotRow): SupportingMetrics {
  return {
    currentPrice: row.price,
    trailingPe: row.trailing_pe,
    evToEbitda: row.ev_to_ebitda,
    evToEbit: computeEvToEbit(row.enterprise_value, row.ebit),
    netDebtToEbitda: computeNetDebtToEbitda(row.total_debt, row.total_cash, row.ebitda),
    interestCoverage: computeInterestCoverage(row.ebit, row.interest_expense),
    beta: row.beta,
    returnOnAssets: row.return_on_assets,
    payoutRatio: row.payout_ratio,
    analyst: {
      numAnalysts: row.num_analysts,
      rating: row.rating,
      targetLow: row.target_low,
      targetMean: row.fair_value, // fair_value IS the mean analyst target price, see parse.ts parseValuation
      targetHigh: row.target_high,
      recStrongBuy: row.rec_strong_buy,
      recBuy: row.rec_buy,
      recHold: row.rec_hold,
      recSell: row.rec_sell,
      recStrongSell: row.rec_strong_sell,
    },
  };
}
