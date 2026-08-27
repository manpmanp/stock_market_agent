import type { Env, UniverseEntry } from "../lib/types.js";
import { fetchChart, fetchQuoteSummary } from "../lib/yahoo.js";
import { parseFundamentals, parseIdentity, parsePriceHistory, parseValuation } from "../lib/parse.js";
import { insertFundamentals, insertValuation, logSource, upsertPriceHistory, upsertStock } from "../lib/db.js";
// Plain JSON import (no "with { type: 'json' }" attribute): esbuild, which
// both Wrangler and Vitest bundle with, resolves .json imports natively and
// an older bundled esbuild version chokes on the import-attribute syntax.
import universeConfig from "../../config/universe.json";

export interface IngestionSummary {
  tickersProcessed: number;
  priceBarsWritten: number;
  fundamentalsWritten: number;
  valuationsWritten: number;
  errors: Array<{ ticker: string; stage: string; error: string }>;
}

export function loadUniverse(): UniverseEntry[] {
  return universeConfig.tickers as UniverseEntry[];
}

/** Ingests one ticker: price history + fundamentals/valuation. Never throws;
 *  failures are logged to source_log and returned so one bad ticker can't
 *  abort the run for the other 19. */
async function ingestTicker(env: Env, entry: UniverseEntry, summary: IngestionSummary): Promise<void> {
  const chart = await fetchChart(entry.ticker);
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
export async function runIngestion(env: Env, delayMs = 250): Promise<IngestionSummary> {
  const universe = loadUniverse();
  const summary: IngestionSummary = {
    tickersProcessed: 0,
    priceBarsWritten: 0,
    fundamentalsWritten: 0,
    valuationsWritten: 0,
    errors: [],
  };

  for (const entry of universe) {
    await ingestTicker(env, entry, summary);
    summary.tickersProcessed += 1;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return summary;
}
