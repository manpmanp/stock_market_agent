// Composite scoring, v2: self-relative, not cross-sectional.
//
// v1 percentile-ranked every metric against the rest of that day's universe
// snapshot -- "cheap relative to these 19 other tickers today." That answers
// a portfolio-selection question ("which of these is the best pick right
// now"), not the question this agent is actually meant to answer: for THIS
// stock, on its own, is now a reasonable time to buy, given where its price
// sits in its own history and where its trend is headed. Comparing stocks
// to each other was the bug, not a tuning knob.
//
// v2 scores every stock in isolation. No metric here is computed relative
// to any other row in the universe. The three inputs are:
//   - valuation: where today's price sits in this stock's own ~5y range,
//     plus the gap vs analyst fair value (already self-referential in v1).
//   - quality: fixed, documented benchmark thresholds (e.g. "ROE above 15%
//     is strong"), not percentile rank against whichever 19 tickers happen
//     to be in the universe config today.
//   - entry timing: a trend-state read (pullback in an uptrend vs. genuine
//     downtrend vs. near its own historical highs) from indicators.ts,
//     purely from that one ticker's own price action.
// A composite 0-100 "suitability for this horizon" score is still computed
// per stock so results can be sorted for display, but sorting a list is not
// the same thing as deriving one stock's score from another's -- nothing
// here changes if you add or remove tickers from the universe.

export interface UniverseRow {
  ticker: string;
  price: number | null;
  // fundamentals
  trailingPe: number | null;
  pegRatio: number | null;
  fcfYield: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  returnOnEquity: number | null;
  revenueGrowthYoy: number | null;
  earningsGrowthYoy: number | null;
  debtToEquity: number | null;
  // valuation estimates
  fairValue: number | null;
  numAnalysts: number | null;
  // technicals
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  priceVsSma50: number | null;
  priceVsSma200: number | null;
  volumeTrend20d: number | null;
  dividendYield: number | null;
  volatility30d: number | null;
  // self-relative valuation/trend inputs (see scoring/indicators.ts)
  priceRangePercentile: number | null;
  distFromHighPct: number | null;
  distFromLowPct: number | null;
  trendState: "pullback_in_uptrend" | "near_historical_highs" | "downtrend" | "neutral" | null;
}

export type Style = "growth" | "defensive" | "blend";
export type ValuationLabel = "undervalued" | "fair_value" | "overvalued";
export type QualityLabel = "strong" | "adequate" | "weak";

export interface ScoredRow {
  ticker: string;
  excluded: boolean;
  excludedReason: string | null;
  valuationScore: number | null;
  qualityScore: number | null;
  momentumScore: number | null; // entry-timing score, kept as "momentum" for schema/API compatibility
  valuationGapPct: number | null;
  valuationLabel: ValuationLabel | null;
  qualityLabel: QualityLabel | null;
  entryState: UniverseRow["trendState"];
  scores: { short: number | null; mid: number | null; long: number | null };
  drivers: string[];
  style: Style | null;
}

// Horizon weights: [valuation, quality, entry timing]. Long-term leans on
// fundamentals/quality (moat, margins), short-term leans on entry timing
// (is this a good moment to buy, not just a good business), mid-term
// blends both. Adjust here, not scattered through the code, if these get
// backtested and revised.
const HORIZON_WEIGHTS = {
  short: { valuation: 0.2, quality: 0.2, entryTiming: 0.6 },
  mid: { valuation: 0.4, quality: 0.3, entryTiming: 0.3 },
  long: { valuation: 0.35, quality: 0.55, entryTiming: 0.1 },
} as const;

// Growth/defensive style, from fixed thresholds on this stock's own
// reported growth/dividend/volatility figures -- not compared to the rest
// of the universe. Coarse and documented, not tuned; revisit once there's
// enough history to backtest against.
const GROWTH_YOY_THRESHOLD = 0.1; // >10% revenue or earnings growth
const LOW_DIVIDEND_THRESHOLD = 0.02; // <2% yield
const HIGH_DIVIDEND_THRESHOLD = 0.03; // >3% yield
const LOW_VOLATILITY_THRESHOLD = 0.25; // <25% annualized stdev of daily returns

function classifyStyle(row: UniverseRow): Style | null {
  if (row.revenueGrowthYoy === null && row.earningsGrowthYoy === null && row.dividendYield === null) return null;
  const growthy = (row.revenueGrowthYoy ?? -Infinity) > GROWTH_YOY_THRESHOLD || (row.earningsGrowthYoy ?? -Infinity) > GROWTH_YOY_THRESHOLD;
  const lowDividend = (row.dividendYield ?? 1) < LOW_DIVIDEND_THRESHOLD;
  const highDividend = (row.dividendYield ?? 0) > HIGH_DIVIDEND_THRESHOLD;
  const lowVol = (row.volatility30d ?? 1) < LOW_VOLATILITY_THRESHOLD;
  if (growthy && lowDividend) return "growth";
  if (highDividend && lowVol) return "defensive";
  return "blend";
}

// Minimum data a row needs to be scored at all. Anything short of this
// goes to the "excluded, insufficient data" list instead of being
// silently scored on partial data.
function missingCriticalFields(row: UniverseRow): string | null {
  if (row.price === null) return "no current price";
  if (row.trailingPe === null && row.fairValue === null) return "no valuation data (P/E and fair value both missing)";
  if (row.rsi14 === null && row.priceVsSma50 === null) return "insufficient price history for technicals";
  return null;
}

function avgIgnoringNulls(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Self-relative valuation: how cheap/expensive this stock is FOR ITSELF,
 *  from two independent signals, each purely a function of this one row:
 *    1. where today's price sits within its own ~5y range (percentile)
 *    2. the gap vs analyst fair value (already self-referential in v1)
 *  Both are mapped to a -1 (cheap) .. +1 (expensive) scale and averaged,
 *  then rescaled to 0-100 where higher = more attractively priced. */
function valuationVerdict(
  row: UniverseRow,
  gapPct: number | null
): { score: number | null; label: ValuationLabel | null } {
  const rangeSignal = row.priceRangePercentile === null ? null : 1 - 2 * row.priceRangePercentile; // 1 = at own low, -1 = at own high
  const gapSignal = gapPct === null ? null : clamp(-gapPct / 0.25, -1, 1); // 25% below fair value -> +1
  const avg = avgIgnoringNulls([rangeSignal, gapSignal]);
  if (avg === null) return { score: null, label: null };
  const score = Math.round(((avg + 1) / 2) * 1000) / 10;
  const label: ValuationLabel = score >= 65 ? "undervalued" : score <= 35 ? "overvalued" : "fair_value";
  return { score, label };
}

// Quality: fixed benchmark thresholds per metric, rescaled to 0-100 and
// averaged. These are coarse, documented starting points -- adjust the
// numbers here, not the shape of the function, once there's real
// performance data to tune against.
//
// bandScore interpolates linearly between "weak" (0 points) and "strong"
// (1 point), clamped outside that range. It used to be a 0/0.5/1 step
// function -- any value between the two thresholds scored the identical
// 0.5, so e.g. 9% ROE and 14% ROE (both "adequate") were indistinguishable.
// Averaged across 7 metrics at 55% of the long-horizon weight, that
// discretization was the single biggest thing compressing the composite
// score spread between real, differently-good companies. Interpolating
// keeps the same fixed, absolute thresholds -- nothing here compares one
// row to another -- it just stops throwing away the real difference
// between two values that both happen to fall in the same band.
function bandScore(value: number | null, weak: number, strong: number, higherIsBetter = true): number | null {
  if (value === null) return null;
  const t = higherIsBetter ? (value - weak) / (strong - weak) : (weak - value) / (weak - strong);
  return clamp(t, 0, 1);
}

// These weak/strong bands were originally set as generic "is this a
// decent company at all" thresholds -- reasonable for scoring an
// unfiltered universe. But this universe isn't unfiltered: it's a
// curated list of index blue-chips and mega-caps, which mostly clear
// old thresholds like "15% ROE" or "15% gross margin" comfortably.
// Once a metric clears "strong," bandScore clamps it to 1 -- so most
// rows were landing at or near 1.0 on most of these 7 metrics, and
// quality (55% of the long-horizon weight) collapsed into a near-
// constant "everyone here is elite" score. That's very likely the
// biggest remaining source of score compression after the step-
// function fix: quality dominates the long-horizon weight but wasn't
// differentiating within this specific (already-strong) universe,
// leaving only valuation (35%) and entry timing (10%) to spread
// scores out. Raising "strong" to where real blue-chip metrics
// actually top out restores headroom above weak-but-still-decent
// companies. Still fixed, absolute, self-relative thresholds --
// nothing here compares one row to another -- just recalibrated for
// who's actually in this universe. Revisit with live data once /rankings
// is reachable to confirm the new bands aren't now too generous.
function qualityVerdict(row: UniverseRow): { score: number | null; label: QualityLabel | null } {
  const points = [
    bandScore(row.grossMargin, 0.2, 0.6),
    bandScore(row.operatingMargin, 0.05, 0.3),
    bandScore(row.netMargin, 0.03, 0.25),
    bandScore(row.returnOnEquity, 0.08, 0.3),
    bandScore(row.debtToEquity, 2.5, 0.3, false),
    bandScore(row.revenueGrowthYoy, 0, 0.15),
    bandScore(row.earningsGrowthYoy, 0, 0.15),
  ];
  const avg = avgIgnoringNulls(points);
  if (avg === null) return { score: null, label: null };
  const score = Math.round(avg * 1000) / 10;
  const label: QualityLabel = score >= 70 ? "strong" : score >= 40 ? "adequate" : "weak";
  return { score, label };
}

// Entry timing: reads the trendState already computed per-ticker in
// indicators.ts (itself purely a function of that ticker's own price
// series) into a 0-100 score plus a human driver string. RSI still
// contributes as an absolute overbought/oversold signal (neutral RSI is
// meaningful on its own terms, not vs other tickers).
function entryTimingVerdict(row: UniverseRow): { score: number | null; driver: string | null } {
  const stateScore: Record<NonNullable<UniverseRow["trendState"]>, number> = {
    pullback_in_uptrend: 80,
    neutral: 50,
    near_historical_highs: 30,
    downtrend: 20,
  };
  const stateDriver: Record<NonNullable<UniverseRow["trendState"]>, string> = {
    pullback_in_uptrend: "pulled back within an ongoing uptrend -- historically often a temporary dip",
    neutral: "no strong entry-timing signal either way",
    near_historical_highs: "trading near its own multi-year high -- may be worth waiting for a pullback",
    downtrend: "in a downtrend -- a falling price here isn't yet evidence of a good entry",
  };
  const rsiScore = row.rsi14 === null ? null : 1 - Math.abs(row.rsi14 - 50) / 50; // 0-1, peaks at neutral RSI

  if (row.trendState === null) {
    return { score: rsiScore === null ? null : Math.round(rsiScore * 1000) / 10, driver: null };
  }
  const base = stateScore[row.trendState];
  const combined = rsiScore === null ? base : base * 0.7 + rsiScore * 100 * 0.3;
  return { score: Math.round(combined * 10) / 10, driver: stateDriver[row.trendState] };
}

export function scoreUniverse(rows: UniverseRow[]): ScoredRow[] {
  return rows.map((row) => {
    const gapPct = row.price !== null && row.fairValue ? (row.price - row.fairValue) / row.fairValue : null;
    const style = classifyStyle(row);

    const reason = missingCriticalFields(row);
    if (reason) {
      return {
        ticker: row.ticker,
        excluded: true,
        excludedReason: reason,
        valuationScore: null,
        qualityScore: null,
        momentumScore: null,
        valuationGapPct: gapPct,
        valuationLabel: null,
        qualityLabel: null,
        entryState: null,
        scores: { short: null, mid: null, long: null },
        drivers: [],
        style: null,
      };
    }

    const valuation = valuationVerdict(row, gapPct);
    const quality = qualityVerdict(row);
    const entry = entryTimingVerdict(row);

    const composite = (weights: { valuation: number; quality: number; entryTiming: number }) => {
      const parts: Array<[number | null, number]> = [
        [valuation.score, weights.valuation],
        [quality.score, weights.quality],
        [entry.score, weights.entryTiming],
      ];
      const present = parts.filter((p): p is [number, number] => p[0] !== null);
      if (present.length === 0) return null;
      const weightSum = present.reduce((a, [, w]) => a + w, 0);
      const weighted = present.reduce((a, [s, w]) => a + s * w, 0);
      return weightSum > 0 ? Math.round((weighted / weightSum) * 10) / 10 : null; // 0-100 scale
    };

    const drivers: string[] = [];
    if (gapPct !== null) {
      drivers.push(`price ${gapPct < 0 ? "below" : "above"} avg analyst fair value by ${Math.abs(Math.round(gapPct * 1000) / 10)}%`);
    }
    if (row.priceRangePercentile !== null) {
      drivers.push(`sits at the ${Math.round(row.priceRangePercentile * 100)}th percentile of its own ~5y price range`);
    }
    if (row.returnOnEquity !== null) drivers.push(`ROE ${Math.round(row.returnOnEquity * 1000) / 10}%`);
    if (row.rsi14 !== null) drivers.push(`RSI ${Math.round(row.rsi14)}`);
    if (entry.driver) drivers.push(entry.driver);

    return {
      ticker: row.ticker,
      excluded: false,
      excludedReason: null,
      valuationScore: valuation.score,
      qualityScore: quality.score,
      momentumScore: entry.score,
      valuationGapPct: gapPct,
      valuationLabel: valuation.label,
      qualityLabel: quality.label,
      entryState: row.trendState,
      scores: {
        short: composite(HORIZON_WEIGHTS.short),
        mid: composite(HORIZON_WEIGHTS.mid),
        long: composite(HORIZON_WEIGHTS.long),
      },
      drivers,
      style,
    };
  });
}

/** Sorted, non-excluded rows for a horizon -- a display convenience only.
 *  Every score behind this sort is computed purely from that one ticker's
 *  own data (see scoreUniverse above); sorting the resulting list for
 *  presentation is not the same thing as deriving one stock's score from
 *  another's. Renamed callers should read this as "candidates for this
 *  horizon, most-suitable first," not "the winners of a competition." */
export function topN(scored: ScoredRow[], horizon: "short" | "mid" | "long", n = 20): ScoredRow[] {
  return scored
    .filter((r) => !r.excluded && r.scores[horizon] !== null)
    .sort((a, b) => (b.scores[horizon] as number) - (a.scores[horizon] as number))
    .slice(0, n);
}
