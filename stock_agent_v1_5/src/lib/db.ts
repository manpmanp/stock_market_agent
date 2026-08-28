import type {
  Env,
  FundamentalsRecord,
  PriceBar,
  StockIdentity,
  ValuationRecord,
} from "./types.js";

export async function upsertStock(env: Env, id: StockIdentity): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO stocks (ticker, exchange, isin, name, sector, industry, currency, region)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET
       exchange = excluded.exchange,
       isin = excluded.isin,
       name = excluded.name,
       sector = excluded.sector,
       industry = excluded.industry,
       currency = excluded.currency,
       region = excluded.region`
  )
    .bind(id.ticker, id.exchange, id.isin, id.name, id.sector, id.industry, id.currency, id.region)
    .run();
}

/** Upserts price bars in batches. D1 has a per-statement bound-parameter limit,
 *  so this chunks rather than sending the whole history in one statement. */
export async function upsertPriceHistory(env: Env, ticker: string, bars: PriceBar[]): Promise<number> {
  const CHUNK = 50;
  let written = 0;
  for (let i = 0; i < bars.length; i += CHUNK) {
    const chunk = bars.slice(i, i + CHUNK);
    const stmts = chunk.map((bar) =>
      env.DB.prepare(
        `INSERT INTO price_history (ticker, date, open, high, low, close, adj_close, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ticker, date) DO UPDATE SET
           open = excluded.open, high = excluded.high, low = excluded.low,
           close = excluded.close, adj_close = excluded.adj_close, volume = excluded.volume`
      ).bind(ticker, bar.date, bar.open, bar.high, bar.low, bar.close, bar.adjClose, bar.volume)
    );
    await env.DB.batch(stmts);
    written += chunk.length;
  }
  return written;
}

export async function insertFundamentals(env: Env, ticker: string, f: FundamentalsRecord): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO fundamentals_snapshot (
       ticker, trailing_pe, forward_pe, price_to_book, price_to_sales, ev_to_ebitda,
       dividend_yield, payout_ratio, revenue_growth_yoy, earnings_growth_yoy,
       gross_margin, operating_margin, net_margin, return_on_equity,
       return_on_invested_capital, debt_to_equity, free_cash_flow, fcf_yield,
       market_cap, peg_ratio
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      ticker,
      f.trailingPe,
      f.forwardPe,
      f.priceToBook,
      f.priceToSales,
      f.evToEbitda,
      f.dividendYield,
      f.payoutRatio,
      f.revenueGrowthYoy,
      f.earningsGrowthYoy,
      f.grossMargin,
      f.operatingMargin,
      f.netMargin,
      f.returnOnEquity,
      f.returnOnInvestedCapital,
      f.debtToEquity,
      f.freeCashFlow,
      f.fcfYield,
      f.marketCap,
      f.pegRatio
    )
    .run();
}

export async function insertValuation(env: Env, ticker: string, v: ValuationRecord): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO valuation_estimates (ticker, source, fair_value, target_price, target_low, target_high, rating, num_analysts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(ticker, v.source, v.fairValue, v.targetPrice, v.targetLow, v.targetHigh, v.rating, v.numAnalysts)
    .run();
}

export async function insertTechnical(
  env: Env,
  ticker: string,
  asOfDate: string,
  indicators: Record<string, number | string | null>
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO technical_snapshot (
       ticker, as_of_date, rsi_14, macd, macd_signal, sma_50, sma_100, sma_200,
       price_vs_sma50, price_vs_sma200, volatility_30d, volume_trend_20d,
       price_range_pct, dist_from_high_pct, dist_from_low_pct, trend_state
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      ticker,
      asOfDate,
      indicators.rsi14 ?? null,
      indicators.macd ?? null,
      indicators.macdSignal ?? null,
      indicators.sma50 ?? null,
      indicators.sma100 ?? null,
      indicators.sma200 ?? null,
      indicators.priceVsSma50 ?? null,
      indicators.priceVsSma200 ?? null,
      indicators.volatility30d ?? null,
      indicators.volumeTrend20d ?? null,
      indicators.priceRangePercentile ?? null,
      indicators.distFromHighPct ?? null,
      indicators.distFromLowPct ?? null,
      indicators.trendState ?? null
    )
    .run();
}

export async function logSource(
  env: Env,
  entry: {
    source: string;
    ticker?: string;
    url?: string;
    status: "ok" | "error" | "skipped_rate_limit" | "no_data";
    httpStatus?: number;
    error?: string;
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO source_log (source, ticker, url, status, http_status, error)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      entry.source,
      entry.ticker ?? null,
      entry.url ?? null,
      entry.status,
      entry.httpStatus ?? null,
      entry.error ?? null
    )
    .run();
}

export interface UniverseSnapshotRow {
  ticker: string;
  price: number | null;
  trailing_pe: number | null;
  peg_ratio: number | null;
  fcf_yield: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  net_margin: number | null;
  return_on_equity: number | null;
  revenue_growth_yoy: number | null;
  earnings_growth_yoy: number | null;
  debt_to_equity: number | null;
  fair_value: number | null;
  num_analysts: number | null;
  rsi_14: number | null;
  macd: number | null;
  macd_signal: number | null;
  price_vs_sma50: number | null;
  price_vs_sma200: number | null;
  volume_trend_20d: number | null;
  dividend_yield: number | null;
  volatility_30d: number | null;
  price_range_pct: number | null;
  dist_from_high_pct: number | null;
  dist_from_low_pct: number | null;
  trend_state: string | null;
}

/** One row per ticker in `stocks`, joined against each table's most recent
 *  snapshot (by pulled_at). Tickers with no data yet in a given table just
 *  come back with nulls for those columns -- scoring decides what to do
 *  with that (see scoring/score.ts missingCriticalFields). */
export async function getUniverseSnapshot(env: Env): Promise<UniverseSnapshotRow[]> {
  const { results } = await env.DB.prepare(
    `WITH latest_price AS (
       SELECT ticker, close AS price
       FROM (
         SELECT ticker, close,
                ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
         FROM price_history WHERE close IS NOT NULL
       ) WHERE rn = 1
     ),
     latest_fundamentals AS (
       SELECT * FROM (
         SELECT f.*, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY pulled_at DESC) AS rn
         FROM fundamentals_snapshot f
       ) WHERE rn = 1
     ),
     latest_valuation AS (
       SELECT * FROM (
         SELECT v.*, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY pulled_at DESC) AS rn
         FROM valuation_estimates v
       ) WHERE rn = 1
     ),
     latest_technical AS (
       SELECT * FROM (
         SELECT t.*, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY pulled_at DESC) AS rn
         FROM technical_snapshot t
       ) WHERE rn = 1
     )
     SELECT
       s.ticker,
       lp.price,
       lf.trailing_pe, lf.peg_ratio, lf.fcf_yield, lf.gross_margin, lf.operating_margin,
       lf.net_margin, lf.return_on_equity, lf.revenue_growth_yoy, lf.earnings_growth_yoy,
       lf.debt_to_equity, lf.dividend_yield,
       lv.fair_value, lv.num_analysts,
       lt.rsi_14, lt.macd, lt.macd_signal, lt.price_vs_sma50, lt.price_vs_sma200, lt.volume_trend_20d,
       lt.volatility_30d, lt.price_range_pct, lt.dist_from_high_pct, lt.dist_from_low_pct, lt.trend_state
     FROM stocks s
     LEFT JOIN latest_price lp ON lp.ticker = s.ticker
     LEFT JOIN latest_fundamentals lf ON lf.ticker = s.ticker
     LEFT JOIN latest_valuation lv ON lv.ticker = s.ticker
     LEFT JOIN latest_technical lt ON lt.ticker = s.ticker
     WHERE s.active = 1`
  ).all<UniverseSnapshotRow>();
  return results ?? [];
}

export interface RankingRow {
  horizon: string;
  ticker: string;
  rank: number;
  compositeScore: number | null;
  valuationScore: number | null;
  qualityScore: number | null;
  momentumScore: number | null;
  valuationGapPct: number | null;
  rationale: string | null;
  excludedReason: string | null;
  style: string | null;
  /** "undervalued" | "fair_value" | "overvalued" -- vs this stock's OWN
   *  5y range and analyst fair value, never vs other tickers. */
  valuationLabel: string | null;
  /** "strong" | "adequate" | "weak" -- vs fixed fundamental benchmarks. */
  qualityLabel: string | null;
  /** raw trendState from indicators.ts -- the entry-timing read. */
  entryState: string | null;
}

/** Writes ranking rows in batches rather than one INSERT per row.
 *
 *  This isn't just a performance optimization: `run_at` defaults to
 *  `datetime('now')` at the SQL level, and getLatestRankings() picks the
 *  single MAX(run_at) per horizon. One-row-at-a-time inserts over ~20
 *  sequential network round-trips can (and did, in production) cross a
 *  one-second boundary mid-run, splitting one logical scoring run across
 *  two timestamps -- so "latest" silently became "whichever few rows
 *  landed in the final second," not the whole run. `env.DB.batch()`
 *  executes every statement in one round-trip, so they share one instant
 *  and `explicitRunAt` pins that instant to a single value we control
 *  (rather than 20 independent `datetime('now')` evaluations), belt and
 *  suspenders against the same class of bug. */
export async function insertRankingsBatch(env: Env, rows: RankingRow[], explicitRunAt: string): Promise<void> {
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const stmts = chunk.map((row) =>
      env.DB.prepare(
        `INSERT INTO rankings (
           run_at, horizon, ticker, rank, composite_score, valuation_score, quality_score,
           momentum_score, valuation_gap_pct, rationale, excluded_reason, style,
           valuation_label, quality_label, entry_state
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        explicitRunAt,
        row.horizon,
        row.ticker,
        row.rank,
        row.compositeScore,
        row.valuationScore,
        row.qualityScore,
        row.momentumScore,
        row.valuationGapPct,
        row.rationale,
        row.excludedReason,
        row.style,
        row.valuationLabel,
        row.qualityLabel,
        row.entryState
      )
    );
    await env.DB.batch(stmts);
  }
}

export async function getLatestRankings(
  env: Env,
  horizon: string,
  limit = 20
): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM rankings
     WHERE horizon = ? AND run_at = (SELECT MAX(run_at) FROM rankings WHERE horizon = ?)
     ORDER BY rank ASC LIMIT ?`
  )
    .bind(horizon, horizon, limit)
    .all();
  return results ?? [];
}

/** Deletes snapshot/log/ranking rows older than `keepDays`. These tables are
 *  append-only by design (every ingestion/scoring run adds new rows rather
 *  than updating old ones, see insertTechnical/insertRankingsBatch), which
 *  is fine at once-a-day cadence but grows unbounded once the scheduled
 *  handler runs hourly -- this keeps D1 storage/read costs flat regardless
 *  of how long the Worker has been running. price_history is NOT pruned
 *  here: scoring's 5y self-relative valuation signal needs that history to
 *  stay intact. Called once a day (from the "full" scheduled run only, see
 *  index.ts) rather than every hour, since it's itself a handful of writes
 *  and there's no benefit to running it more often. */
export async function pruneOldSnapshots(env: Env, keepDays = 30): Promise<void> {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM technical_snapshot WHERE pulled_at < ?`).bind(cutoff),
    env.DB.prepare(`DELETE FROM fundamentals_snapshot WHERE pulled_at < ?`).bind(cutoff),
    env.DB.prepare(`DELETE FROM valuation_estimates WHERE pulled_at < ?`).bind(cutoff),
    env.DB.prepare(`DELETE FROM rankings WHERE run_at < ?`).bind(cutoff),
    env.DB.prepare(`DELETE FROM source_log WHERE pulled_at < ?`).bind(cutoff),
  ]);
}

export async function getLatestPriceHistory(
  env: Env,
  ticker: string,
  limit = 260
): Promise<Array<{ date: string; close: number; volume: number | null }>> {
  const { results } = await env.DB.prepare(
    `SELECT date, close, volume FROM price_history
     WHERE ticker = ? AND close IS NOT NULL
     ORDER BY date DESC LIMIT ?`
  )
    .bind(ticker, limit)
    .all<{ date: string; close: number; volume: number | null }>();
  return (results ?? []).reverse(); // chronological order for indicator math
}
