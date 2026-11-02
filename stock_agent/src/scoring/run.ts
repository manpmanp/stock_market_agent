import type { Env } from "../lib/types.js";
import {
  getLatestPriceHistory,
  getUniverseSnapshot,
  insertRankingsBatch,
  insertTechnical,
  type RankingRow,
} from "../lib/db.js";
import { computeIndicators } from "./indicators.js";
import { scoreUniverse, topN, type UniverseRow } from "./score.js";

export interface ScoringSummary {
  tickersScored: number;
  tickersExcluded: number;
  rankingsWritten: number;
}

/** Recomputes technical indicators for every ticker with price history, then
 *  scores the whole universe and persists a fresh rankings run. Meant to run
 *  right after ingestion (see src/index.ts scheduled handler), but is safe
 *  to call on its own against whatever data already exists in D1. */
export async function runScoring(env: Env): Promise<ScoringSummary> {
  const snapshot = await getUniverseSnapshot(env);

  // Recompute technicals fresh from price_history so they're never stale
  // relative to today's prices, then re-read the snapshot to pick them up.
  for (const row of snapshot) {
    // ~5y of daily bars (see lib/yahoo.ts fetchChart default), so the
    // self-relative range percentile spans a real market cycle rather than
    // just the last year.
    const points = await getLatestPriceHistory(env, row.ticker, 1300);
    if (points.length === 0) continue;
    const indicators = computeIndicators(points.map((p) => ({ date: p.date, close: p.close, volume: p.volume })));
    if (!indicators.asOfDate) continue;
    await insertTechnical(env, row.ticker, indicators.asOfDate, {
      rsi14: indicators.rsi14,
      macd: indicators.macd,
      macdSignal: indicators.macdSignal,
      sma50: indicators.sma50,
      sma100: indicators.sma100,
      sma200: indicators.sma200,
      priceVsSma50: indicators.priceVsSma50,
      priceVsSma200: indicators.priceVsSma200,
      volatility30d: indicators.volatility30d,
      volumeTrend20d: indicators.volumeTrend20d,
      priceRangePercentile: indicators.priceRangePercentile,
      distFromHighPct: indicators.distFromHighPct,
      distFromLowPct: indicators.distFromLowPct,
      trendState: indicators.trendState,
    });
  }

  const refreshed = await getUniverseSnapshot(env);
  const rows: UniverseRow[] = refreshed.map((r) => ({
    ticker: r.ticker,
    price: r.price,
    trailingPe: r.trailing_pe,
    pegRatio: r.peg_ratio,
    fcfYield: r.fcf_yield,
    grossMargin: r.gross_margin,
    operatingMargin: r.operating_margin,
    netMargin: r.net_margin,
    returnOnEquity: r.return_on_equity,
    revenueGrowthYoy: r.revenue_growth_yoy,
    earningsGrowthYoy: r.earnings_growth_yoy,
    debtToEquity: r.debt_to_equity,
    fairValue: r.fair_value,
    numAnalysts: r.num_analysts,
    rsi14: r.rsi_14,
    macd: r.macd,
    macdSignal: r.macd_signal,
    priceVsSma50: r.price_vs_sma50,
    priceVsSma200: r.price_vs_sma200,
    volumeTrend20d: r.volume_trend_20d,
    dividendYield: r.dividend_yield,
    volatility30d: r.volatility_30d,
    priceRangePercentile: r.price_range_pct,
    distFromHighPct: r.dist_from_high_pct,
    distFromLowPct: r.dist_from_low_pct,
    trendState: r.trend_state as UniverseRow["trendState"],
  }));

  const scored = scoreUniverse(rows);

  // One timestamp for the whole run, computed once and written explicitly on
  // every row (see insertRankingsBatch doc comment) so "the latest run" is
  // never split across a second boundary by network latency.
  const runAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  const rankingRows: RankingRow[] = [];

  for (const excludedRow of scored.filter((r) => r.excluded)) {
    rankingRows.push({
      horizon: "excluded",
      ticker: excludedRow.ticker,
      rank: 0,
      compositeScore: null,
      valuationScore: null,
      qualityScore: null,
      momentumScore: null,
      valuationGapPct: excludedRow.valuationGapPct,
      rationale: null,
      excludedReason: excludedRow.excludedReason,
      style: null,
      valuationLabel: null,
      qualityLabel: null,
      entryState: null,
    });
  }

  for (const horizon of ["short", "mid", "long"] as const) {
    const ranked = topN(scored, horizon, 20);
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i] as (typeof ranked)[number];
      rankingRows.push({
        horizon,
        ticker: r.ticker,
        rank: i + 1,
        compositeScore: r.scores[horizon],
        valuationScore: r.valuationScore,
        qualityScore: r.qualityScore,
        momentumScore: r.momentumScore,
        valuationGapPct: r.valuationGapPct,
        rationale: r.drivers.join("; ") || null,
        excludedReason: null,
        style: r.style,
        valuationLabel: r.valuationLabel,
        qualityLabel: r.qualityLabel,
        entryState: r.entryState,
      });
    }
  }

  await insertRankingsBatch(env, rankingRows, runAt);
  const rankingsWritten = rankingRows.length;

  return {
    tickersScored: scored.filter((r) => !r.excluded).length,
    tickersExcluded: scored.filter((r) => r.excluded).length,
    rankingsWritten,
  };
}
