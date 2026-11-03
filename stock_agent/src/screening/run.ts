// Stage A of the universe-widening screen (see docs/agentic-architecture-
// proposal.md, build-order step 2): a cheap, broad valuation+momentum
// pass over a much larger candidate pool (config/broad-universe.json,
// S&P 500 to start) than config/universe.json's 169 hand-picked tickers.
//
// This is deliberately NOT the full Decision Lab pipeline -- it only
// pulls summaryDetail/defaultKeyStatistics (for trailing P/E, P/B,
// EV/EBITDA) and a short price history (for 3-month momentum) per
// candidate, cross-sectionally percentile-ranks each metric against the
// rest of this run's pool, and averages those percentiles into one
// screen_score per ticker. The top slice (by score) gets auto-promoted:
// written into the promoted_tickers D1 table so ingestion/run.ts's
// loadFullUniverse() picks them up and they join full tracking (price
// history + fundamentals + valuation + Decision Lab scoring) from the
// next ingestion run onward. See migrations/0010_broad_screening.sql for
// why this needs its own table rather than editing config/universe.json
// (a Worker can't write to its own bundled source files at runtime).
//
// Lower P/E, P/B, and EV/EBITDA are treated as "better" (cheaper) for
// percentile purposes; higher 3-month momentum is treated as "better".
// A candidate missing a metric (Yahoo doesn't always populate all four)
// is simply excluded from that metric's percentile pass -- its
// screen_score is the average of whichever metrics it has, not zero-
// filled, so a ticker missing one field isn't unfairly penalized.

import type { Env, UniverseEntry } from "../lib/types.js";
import { fetchChart, fetchQuoteSummary } from "../lib/yahoo.js";
import type { UsageTotals } from "../lib/usage.js";
import { parsePriceHistory } from "../lib/parse.js";
import {
  getPromotedTickers,
  insertBroadScreenBatch,
  logSource,
  upsertPromotedTicker,
  type BroadScreenRow,
} from "../lib/db.js";
import broadUniverseConfig from "../../config/broad-universe.json";

export function loadBroadUniverse(): UniverseEntry[] {
  return broadUniverseConfig.tickers as UniverseEntry[];
}

export interface BroadScreenSummary {
  candidatesProcessed: number;
  candidatesScored: number;
  newlyPromoted: string[];
  errors: Array<{ ticker: string; error: string }>;
}

interface RawCandidate {
  ticker: string;
  entry: UniverseEntry;
  trailingPe: number | null;
  priceToBook: number | null;
  evToEbitda: number | null;
  momentum3mPct: number | null;
}

/** Cross-sectional 0-100 percentile rank of each value in `values`
 *  (ties share the same rank, via average-rank-of-tied-group). `higherIsBetter`
 *  flips the direction so, e.g., the lowest P/E in the pool scores 100 and
 *  the highest scores near 0. Returns a Map value -> percentile is wrong
 *  for duplicate raw values, so this returns an array aligned to the
 *  input's own order instead. */
function percentileRanks(values: Array<number | null>, higherIsBetter: boolean): Array<number | null> {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null && Number.isFinite(x.v));
  if (present.length <= 1) {
    // Can't meaningfully rank 0 or 1 data point against a pool -- leave
    // every slot null rather than pretending a single value is "the best".
    return values.map(() => null);
  }

  const sorted = [...present].sort((a, b) => a.v - b.v); // ascending
  const out: Array<number | null> = values.map(() => null);
  const n = sorted.length;

  let idx = 0;
  while (idx < n) {
    let j = idx;
    while (j + 1 < n && sorted[j + 1]!.v === sorted[idx]!.v) j += 1;
    // average rank (0-based) of the tied group [idx, j], as a 0-100 pct
    const avgRank = (idx + j) / 2;
    const pct = n === 1 ? 100 : (avgRank / (n - 1)) * 100;
    const finalPct = higherIsBetter ? pct : 100 - pct;
    for (let k = idx; k <= j; k++) out[sorted[k]!.i] = finalPct;
    idx = j + 1;
  }
  return out;
}

function avg(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

export interface BroadScreenOptions {
  /** How many of the highest-scoring candidates to auto-promote per run.
   *  Small on purpose: this runs daily, and promotion is a one-way door
   *  into full tracking (more ingestion cost per ticker going forward),
   *  so it widens the universe gradually rather than all at once. */
  promoteTop?: number;
  /** Floor below which a candidate is never promoted even if it's in the
   *  top N -- guards against promoting junk on a day where most of the
   *  pool is missing data and percentile scores are noisy. */
  minScreenScore?: number;
}

export async function runBroadScreen(
  env: Env,
  opts: BroadScreenOptions = {},
  usage?: UsageTotals,
  onProgress?: (p: { step: string; index: number; total: number; downloadedBytes: number }) => void
): Promise<BroadScreenSummary> {
  const promoteTop = opts.promoteTop ?? 10;
  const minScreenScore = opts.minScreenScore ?? 60;

  const candidates = loadBroadUniverse();
  const summary: BroadScreenSummary = {
    candidatesProcessed: 0,
    candidatesScored: 0,
    newlyPromoted: [],
    errors: [],
  };

  const already = await getPromotedTickers(env);
  const alreadyPromoted = new Set(already.map((p) => p.ticker));

  const raw: RawCandidate[] = [];

  let index = 0;
  for (const entry of candidates) {
    summary.candidatesProcessed += 1;
    try {
      const [quote, chart] = await Promise.all([
        fetchQuoteSummary(entry.ticker, usage),
        fetchChart(entry.ticker, "6mo", "1d", usage),
      ]);

      if (!quote.ok || !quote.data) {
        await logSource(env, {
          source: "yahoo_finance_quote_summary_broad_screen",
          ticker: entry.ticker,
          status: "error",
          httpStatus: quote.status,
          error: quote.error ?? "unknown error",
        });
        summary.errors.push({ ticker: entry.ticker, error: quote.error ?? `HTTP ${quote.status}` });
        continue;
      }

      const result = quote.data.quoteSummary.result?.[0] ?? null;
      const trailingPe = result?.summaryDetail?.trailingPE?.raw ?? null;
      const priceToBook = result?.defaultKeyStatistics?.priceToBook?.raw ?? null;
      const evToEbitda = result?.defaultKeyStatistics?.enterpriseToEbitda?.raw ?? null;

      let momentum3mPct: number | null = null;
      if (chart.ok && chart.data) {
        const bars = parsePriceHistory(chart.data).filter((b) => b.adjClose !== null);
        // ~3 months of trading days out of the 6mo pull, so a data hiccup
        // early in the window still leaves enough bars to compute this.
        const TRADING_DAYS_3M = 63;
        if (bars.length > TRADING_DAYS_3M) {
          const startBar = bars[bars.length - 1 - TRADING_DAYS_3M];
          const endBar = bars[bars.length - 1];
          if (startBar && endBar && startBar.adjClose && endBar.adjClose) {
            momentum3mPct = ((endBar.adjClose - startBar.adjClose) / startBar.adjClose) * 100;
          }
        }
      } else {
        await logSource(env, {
          source: "yahoo_finance_chart_broad_screen",
          ticker: entry.ticker,
          status: "error",
          httpStatus: chart.status,
          error: chart.error ?? "unknown error",
        });
      }

      raw.push({ ticker: entry.ticker, entry, trailingPe, priceToBook, evToEbitda, momentum3mPct });
      await logSource(env, { source: "yahoo_finance_quote_summary_broad_screen", ticker: entry.ticker, status: "ok" });
    } catch (err) {
      summary.errors.push({ ticker: entry.ticker, error: (err as Error).message });
    }
    index += 1;
    if (onProgress) {
      onProgress({ step: entry.ticker, index, total: candidates.length, downloadedBytes: usage ? usage.downloadedBytes : 0 });
    }
  }

  if (raw.length === 0) return summary;

  // Lower is better for valuation ratios, higher is better for momentum.
  const peRanks = percentileRanks(raw.map((r) => r.trailingPe), false);
  const pbRanks = percentileRanks(raw.map((r) => r.priceToBook), false);
  const evRanks = percentileRanks(raw.map((r) => r.evToEbitda), false);
  const momRanks = percentileRanks(raw.map((r) => r.momentum3mPct), true);

  const pulledAt = new Date().toISOString();
  const rows: BroadScreenRow[] = raw.map((r, i) => ({
    ticker: r.ticker,
    trailingPe: r.trailingPe,
    priceToBook: r.priceToBook,
    evToEbitda: r.evToEbitda,
    momentum3mPct: r.momentum3mPct,
    screenScore: avg([peRanks[i] ?? null, pbRanks[i] ?? null, evRanks[i] ?? null, momRanks[i] ?? null]),
  }));

  await insertBroadScreenBatch(env, rows, pulledAt);
  summary.candidatesScored = rows.filter((r) => r.screenScore !== null).length;

  const ranked = rows
    .filter((r) => r.screenScore !== null && r.screenScore >= minScreenScore)
    .filter((r) => !alreadyPromoted.has(r.ticker))
    .sort((a, b) => (b.screenScore ?? 0) - (a.screenScore ?? 0))
    .slice(0, promoteTop);

  for (const r of ranked) {
    const entry = raw.find((c) => c.ticker === r.ticker)!.entry;
    await upsertPromotedTicker(env, {
      ticker: entry.ticker,
      exchange: entry.exchange,
      region: entry.region,
      currency: entry.currency,
      screenScore: r.screenScore,
    });
    summary.newlyPromoted.push(r.ticker);
  }

  return summary;
}
