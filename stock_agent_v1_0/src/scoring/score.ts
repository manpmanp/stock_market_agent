// Composite scoring, per spec ("Part A" section 5 / "Part B").
//
// Deliberately simple and fully documented for v1: every score is a
// weighted average of 0-1 sub-scores, and every sub-score's formula is
// written out below rather than hidden in a model. This is the version
// to sanity-check/backtest (see spec "Remaining open questions") before
// trusting it with real money.
//
// Valuation, quality and momentum sub-scores are computed *cross-
// sectionally*: each metric is percentile-ranked against the rest of
// today's universe snapshot (not against sector or multi-year history,
// which v1's single-source, single-day dataset doesn't yet support).
// That means scores answer "cheap/strong/hot relative to this universe
// today", not "cheap relative to its own 10-year average" -- a real
// limitation to know about, not hide.

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
}

export interface ScoredRow {
  ticker: string;
  excluded: boolean;
  excludedReason: string | null;
  valuationScore: number | null;
  qualityScore: number | null;
  momentumScore: number | null;
  valuationGapPct: number | null;
  scores: { short: number | null; mid: number | null; long: number | null };
  drivers: string[];
}

// Horizon weights: [valuation, quality, momentum]. Long-term leans on
// fundamentals/quality (moat, margins), short-term leans on momentum
// (technicals), mid-term blends both. Adjust here, not scattered
// through the code, if these get backtested and revised.
const HORIZON_WEIGHTS = {
  short: { valuation: 0.2, quality: 0.2, momentum: 0.6 },
  mid: { valuation: 0.4, quality: 0.3, momentum: 0.3 },
  long: { valuation: 0.35, quality: 0.55, momentum: 0.1 },
} as const;

// Minimum data a row needs to be scored at all. Anything short of this
// goes to the "excluded, insufficient data" list instead of being
// silently scored on partial data (spec section 5's data-quality flag).
function missingCriticalFields(row: UniverseRow): string | null {
  if (row.price === null) return "no current price";
  if (row.trailingPe === null && row.fairValue === null) return "no valuation data (P/E and fair value both missing)";
  if (row.rsi14 === null && row.priceVsSma50 === null) return "insufficient price history for technicals";
  return null;
}

function percentileRanks(values: Array<number | null>, higherIsBetter: boolean): Array<number | null> {
  const indexed = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null && Number.isFinite(x.v));
  if (indexed.length <= 1) return values.map((v) => (v === null ? null : 0.5));

  const sorted = [...indexed].sort((a, b) => a.v - b.v);
  const rankOf = new Map<number, number>(); // index in original array -> percentile [0,1]
  sorted.forEach((item, sortedPos) => {
    const pct = sortedPos / (sorted.length - 1);
    rankOf.set(item.i, higherIsBetter ? pct : 1 - pct);
  });

  return values.map((v, i) => (v === null ? null : (rankOf.get(i) ?? null)));
}

function avgIgnoringNulls(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

export function scoreUniverse(rows: UniverseRow[]): ScoredRow[] {
  const valuationGapPct = rows.map((r) =>
    r.price !== null && r.fairValue ? (r.price - r.fairValue) / r.fairValue : null
  );

  const peRank = percentileRanks(rows.map((r) => r.trailingPe), false);
  const pegRank = percentileRanks(rows.map((r) => r.pegRatio), false);
  const fcfYieldRank = percentileRanks(rows.map((r) => r.fcfYield), true);
  const gapRank = percentileRanks(valuationGapPct, false); // more negative gap (undervalued) ranks better

  const grossMarginRank = percentileRanks(rows.map((r) => r.grossMargin), true);
  const opMarginRank = percentileRanks(rows.map((r) => r.operatingMargin), true);
  const netMarginRank = percentileRanks(rows.map((r) => r.netMargin), true);
  const roeRank = percentileRanks(rows.map((r) => r.returnOnEquity), true);
  const revGrowthRank = percentileRanks(rows.map((r) => r.revenueGrowthYoy), true);
  const earnGrowthRank = percentileRanks(rows.map((r) => r.earningsGrowthYoy), true);
  const debtRank = percentileRanks(rows.map((r) => r.debtToEquity), false);

  const priceVsSma50Rank = percentileRanks(rows.map((r) => r.priceVsSma50), true);
  const priceVsSma200Rank = percentileRanks(rows.map((r) => r.priceVsSma200), true);
  const volumeTrendRank = percentileRanks(rows.map((r) => r.volumeTrend20d), true);
  const macdHistogramRank = percentileRanks(
    rows.map((r) => (r.macd !== null && r.macdSignal !== null ? r.macd - r.macdSignal : null)),
    true
  );
  // RSI: score peaks at neutral (50), tapers toward overbought/oversold extremes.
  // Not cross-sectionally ranked -- "neutral RSI" is meaningful in absolute terms.
  const rsiScores = rows.map((r) => (r.rsi14 === null ? null : 1 - Math.abs(r.rsi14 - 50) / 50));

  return rows.map((row, i) => {
    const reason = missingCriticalFields(row);
    if (reason) {
      return {
        ticker: row.ticker,
        excluded: true,
        excludedReason: reason,
        valuationScore: null,
        qualityScore: null,
        momentumScore: null,
        valuationGapPct: valuationGapPct[i] ?? null,
        scores: { short: null, mid: null, long: null },
        drivers: [],
      };
    }

    const valuationScore = avgIgnoringNulls([peRank[i] ?? null, pegRank[i] ?? null, fcfYieldRank[i] ?? null, gapRank[i] ?? null]);
    const qualityScore = avgIgnoringNulls([
      grossMarginRank[i] ?? null,
      opMarginRank[i] ?? null,
      netMarginRank[i] ?? null,
      roeRank[i] ?? null,
      revGrowthRank[i] ?? null,
      earnGrowthRank[i] ?? null,
      debtRank[i] ?? null,
    ]);
    const momentumScore = avgIgnoringNulls([
      rsiScores[i] ?? null,
      priceVsSma50Rank[i] ?? null,
      priceVsSma200Rank[i] ?? null,
      volumeTrendRank[i] ?? null,
      macdHistogramRank[i] ?? null,
    ]);

    const composite = (weights: { valuation: number; quality: number; momentum: number }) => {
      const parts: Array<[number | null, number]> = [
        [valuationScore, weights.valuation],
        [qualityScore, weights.quality],
        [momentumScore, weights.momentum],
      ];
      const present = parts.filter((p): p is [number, number] => p[0] !== null);
      if (present.length === 0) return null;
      const weightSum = present.reduce((a, [, w]) => a + w, 0);
      const weighted = present.reduce((a, [s, w]) => a + s * w, 0);
      return weightSum > 0 ? Math.round((weighted / weightSum) * 1000) / 10 : null; // 0-100 scale
    };

    const drivers: string[] = [];
    if (gapRank[i] !== null && valuationGapPct[i] !== null) {
      drivers.push(
        `price ${valuationGapPct[i]! < 0 ? "below" : "above"} avg analyst fair value by ${Math.abs(
          Math.round((valuationGapPct[i] as number) * 1000) / 10
        )}%`
      );
    }
    if (roeRank[i] !== null && row.returnOnEquity !== null) {
      drivers.push(`ROE ${Math.round(row.returnOnEquity * 1000) / 10}%`);
    }
    if (row.rsi14 !== null) drivers.push(`RSI ${Math.round(row.rsi14)}`);

    return {
      ticker: row.ticker,
      excluded: false,
      excludedReason: null,
      valuationScore,
      qualityScore,
      momentumScore,
      valuationGapPct: valuationGapPct[i] ?? null,
      scores: {
        short: composite(HORIZON_WEIGHTS.short),
        mid: composite(HORIZON_WEIGHTS.mid),
        long: composite(HORIZON_WEIGHTS.long),
      },
      drivers,
    };
  });
}

export function topN(scored: ScoredRow[], horizon: "short" | "mid" | "long", n = 20): ScoredRow[] {
  return scored
    .filter((r) => !r.excluded && r.scores[horizon] !== null)
    .sort((a, b) => (b.scores[horizon] as number) - (a.scores[horizon] as number))
    .slice(0, n);
}
