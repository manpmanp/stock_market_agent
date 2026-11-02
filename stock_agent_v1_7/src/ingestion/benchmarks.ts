// Ingests price history for market-index benchmarks (S&P 500, OMX
// Stockholm 30, DAX, etc. -- see config/benchmarks.json) through the same
// Yahoo Finance chart endpoint and price_history table every stock uses,
// but upserted with active = 0, so these rows are invisible to
// getUniverseSnapshot()'s `WHERE s.active = 1` and can never appear in v1
// rankings, Decision Lab scoring, or the dashboard's ticker counts.
//
// Deliberately separate from runIngestion() in ./run.ts: indices have no
// fundamentals, valuation, or analyst data worth pulling via
// fetchQuoteSummary, so this only ever does the chart (price history)
// call -- cheaper and simpler than reusing the stock ingestion path and
// discarding most of what it fetches.
//
// Two consumers this unlocks, neither built in this pass: (1)
// decision/run.ts's market-regime factor, today hardcoded to one US proxy
// (SPY, fetched fresh in-memory, never persisted) for every ticker
// regardless of region -- `regime_proxy_for` in benchmarks.json already
// names which region each index should serve once that's wired up; (2)
// the backtest harness (scripts/backtest/harness.py), today comparing
// against the tracked universe's own equal-weighted average because no
// real benchmark price history existed anywhere to compare against.

import type { Env } from "../lib/types.js";
import { fetchChart } from "../lib/yahoo.js";
import { parseIdentity, parsePriceHistory } from "../lib/parse.js";
import { logSource, upsertPriceHistory, upsertStock } from "../lib/db.js";
import benchmarksConfig from "../../config/benchmarks.json";

export interface BenchmarkEntry {
  ticker: string;
  name: string;
  exchange: string;
  region: string;
  currency: string;
  regime_proxy_for: string[];
  is_etf_proxy?: boolean;
}

export interface BenchmarkIngestionSummary {
  benchmarksProcessed: number;
  priceBarsWritten: number;
  errors: Array<{ ticker: string; error: string }>;
}

export function loadBenchmarks(): BenchmarkEntry[] {
  return benchmarksConfig.benchmarks as BenchmarkEntry[];
}

export async function runBenchmarkIngestion(
  env: Env,
  opts: { range?: string } = {}
): Promise<BenchmarkIngestionSummary> {
  const range = opts.range ?? "5y";
  const benchmarks = loadBenchmarks();
  const summary: BenchmarkIngestionSummary = { benchmarksProcessed: 0, priceBarsWritten: 0, errors: [] };

  for (const entry of benchmarks) {
    await upsertStock(
      env,
      parseIdentity(entry.ticker, { exchange: entry.exchange, region: "benchmark", currency: entry.currency }, null)
    );
    // upsertStock's INSERT doesn't set `active` (it relies on D1's column
    // default of 1), so flip it off explicitly right after -- the ON
    // CONFLICT path never touches `active` either, so this only needs to
    // run once per ticker in practice, but it's cheap and idempotent to
    // just always send it.
    await env.DB.prepare(`UPDATE stocks SET active = 0 WHERE ticker = ?`).bind(entry.ticker).run();

    const chart = await fetchChart(entry.ticker, range);
    if (!chart.ok || !chart.data) {
      await logSource(env, {
        source: "yahoo_finance_chart_benchmark",
        ticker: entry.ticker,
        status: "error",
        httpStatus: chart.status,
        error: chart.error ?? "unknown error",
      });
      summary.errors.push({ ticker: entry.ticker, error: chart.error ?? `HTTP ${chart.status}` });
      summary.benchmarksProcessed += 1;
      continue;
    }

    const bars = parsePriceHistory(chart.data);
    if (bars.length === 0) {
      await logSource(env, { source: "yahoo_finance_chart_benchmark", ticker: entry.ticker, status: "no_data" });
    } else {
      const written = await upsertPriceHistory(env, entry.ticker, bars);
      summary.priceBarsWritten += written;
      await logSource(env, { source: "yahoo_finance_chart_benchmark", ticker: entry.ticker, status: "ok" });
    }
    summary.benchmarksProcessed += 1;
  }

  return summary;
}
