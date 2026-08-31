import type { Env, UniverseEntry } from "../lib/types.js";
import { fetchChart, fetchQuoteSummary } from "../lib/yahoo.js";
import { parseFundamentals, parseIdentity, parsePriceHistory, parseValuation } from "../lib/parse.js";
import { insertFundamentals, insertValuation, logSource, upsertPriceHistory, upsertStock } from "../lib/db.js";
// Plain JSON import (no "with { type: 'json' }" attribute): esbuild, which
// both Wrangler and Vitest bundle with, resolves .json imports natively and
// an older bundled esbuild version chokes on the import-attribute syntax.
import universeConfig from "../../config/universe.json";

export type IngestionMode = "full" | "incremental";

export interface IngestionSummary {
  mode: IngestionMode;
  tickersProcessed: number;
  priceBarsWritten: number;
  fundamentalsWritten: number;
  valuationsWritten: number;
  errors: Array<{ ticker: string; stage: string; error: string }>;
}

export function loadUniverse(): UniverseEntry[] {
  return universeConfig.tickers as UniverseEntry[];
}

/** Ingests one ticker: price history, and (in "full" mode only) fundamentals/
 *  valuation. Never throws; failures are logged to source_log and returned
 *  so one bad ticker can't abort the run for the other 19.
 *
 *  "full" re-pulls ~5y of daily price history plus fundamentals/valuation --
 *  the expensive path (~1,300 D1 row-writes per ticker), meant to run once
 *  or twice a day. "incremental" pulls just the last 5 days of price bars
 *  (Yahoo's chart data for a stock in progress updates in place, so this
 *  also picks up today's still-forming close) and skips fundamentals/
 *  valuation entirely -- those come from quarterly filings and analyst
 *  targets, which don't meaningfully change hour to hour. That keeps an
 *  hourly cron affordable: ~5 row-writes/ticker instead of ~1,300. See
 *  wrangler.toml [triggers] for how the two crons map to these two modes. */
async function ingestTicker(env: Env, entry: UniverseEntry, summary: IngestionSummary, mode: IngestionMode): Promise<void> {
  // Upsert a minimal stock row FIRST, from the universe config alone. price_history
  // has a foreign key on stocks(ticker), so writing price bars before this row
  // exists fails the whole ticker with a FOREIGN KEY constraint error. This gets
  // overwritten with richer data (name, sector, ...) once quoteSummary comes back.
  await upsertStock(env, parseIdentity(entry.ticker, entry, null));

  const chart = await fetchChart(entry.ticker, mode === "full" ? "5y" : "5d");
  if (!chart.ok || !chart.data) {
    await logSource(env, {
      source: "yahoo_finance_chart",
      ticker: entry.ticker,
      status: "error",
      httpStatus: chart.status,
      error: chart.error ?? "unknown error",
    });
    summary.errors.push({ ticker: entry.ticker, stage: "chart", error: chart.error ?? `HTTP ${chart.status}` });
  } else {
    const bars = parsePriceHistory(chart.data);
    if (bars.length === 0) {
      await logSource(env, { source: "yahoo_finance_chart", ticker: entry.ticker, status: "no_data" });
    } else {
      const written = await upsertPriceHistory(env, entry.ticker, bars);
      summary.priceBarsWritten += written;
      await logSource(env, { source: "yahoo_finance_chart", ticker: entry.ticker, status: "ok" });
    }
  }

  if (mode === "incremental") return; // fundamentals/valuation are the "full" run's job -- see doc comment above

  const quoteSummary = await fetchQuoteSummary(entry.ticker);
  if (!quoteSummary.ok || !quoteSummary.data) {
    await logSource(env, {
      source: "yahoo_finance_quotesummary",
      ticker: entry.ticker,
      status: "error",
      httpStatus: quoteSummary.status,
      error: quoteSummary.error ?? "unknown error",
    });
    summary.errors.push({
      ticker: entry.ticker,
      stage: "quoteSummary",
      error: quoteSummary.error ?? `HTTP ${quoteSummary.status}`,
    });
    return;
  }

  const identity = parseIdentity(entry.ticker, entry, quoteSummary.data);
  await upsertStock(env, identity);

  const fundamentals = parseFundamentals(quoteSummary.data);
  if (fundamentals) {
    await insertFundamentals(env, entry.ticker, fundamentals);
    summary.fundamentalsWritten += 1;
  }

  const valuation = parseValuation(quoteSummary.data);
  if (valuation) {
    await insertValuation(env, entry.ticker, valuation);
    summary.valuationsWritten += 1;
  }

  await logSource(env, { source: "yahoo_finance_quotesummary", ticker: entry.ticker, status: "ok" });
}

/** Runs ingestion for the whole configured universe, sequentially with a
 *  small delay between tickers. Sequential + delayed is deliberate: it's
 *  gentler on Yahoo's endpoints (see spec section 1, "respect rate limits")
 *  and keeps a single Worker invocation well under Cloudflare's CPU-time
 *  limit even on the free plan, at the cost of a slower total run. With a
 *  20-ticker universe this is a non-issue; revisit if the universe grows
 *  much larger than that. */
export async function runIngestion(
  env: Env,
  opts: { mode?: IngestionMode; delayMs?: number } = {}
): Promise<IngestionSummary> {
  const mode = opts.mode ?? "full";
  const delayMs = opts.delayMs ?? 250;
  const universe = loadUniverse();
  const summary: IngestionSummary = {
    mode,
    tickersProcessed: 0,
    priceBarsWritten: 0,
    fundamentalsWritten: 0,
    valuationsWritten: 0,
    errors: [],
  };

  for (const entry of universe) {
    await ingestTicker(env, entry, summary, mode);
    summary.tickersProcessed += 1;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return summary;
}
