// Lightweight, per-request usage accounting for the dashboard's "Run &
// update" admin panel -- so each manual trigger can show a plain-language
// after-the-fact summary: how much was downloaded, where from, how many
// rows were written, and what that would cost against Cloudflare's
// published pricing. Deliberately NOT a module-level counter: Workers can
// reuse the same JS isolate across unrelated requests, so usage state has
// to be created fresh per call (newUsage()) and threaded through explicitly
// (see yahoo.ts's optional `usage` parameter), not kept as shared state.
export interface UsageTotals {
  /** Bytes read from Yahoo Finance responses (src/lib/yahoo.ts's
   *  yahooFetch), the only outbound data source the ingestion/screening
   *  pipeline calls. Measured on the raw response text, so it's a byte
   *  count, not a request count. */
  downloadedBytes: number;
}

export function newUsage(): UsageTotals {
  return { downloadedBytes: 0 };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Cloudflare D1 pricing (Workers Paid plan), checked against
// developers.cloudflare.com/d1/platform/pricing on 2026-11-03 -- re-check
// there before trusting this for anything that matters, prices change.
// Free-tier caps are PER DAY; a single admin-panel run's own row count is
// compared directly against that daily cap as a simple, conservative
// proxy (this Worker has no way to see the account's total usage today),
// so this reads as "$0.00" for any run nowhere near the cap, which is
// every run this project's universe size produces.
const D1_FREE_ROWS_WRITTEN_PER_DAY = 100_000;
const D1_OVERAGE_USD_PER_MILLION_WRITTEN = 1.0;

export function estimateD1WriteCostUsd(rowsWritten: number): number {
  const overage = Math.max(0, rowsWritten - D1_FREE_ROWS_WRITTEN_PER_DAY);
  return (overage / 1_000_000) * D1_OVERAGE_USD_PER_MILLION_WRITTEN;
}

export function formatCostUsd(usd: number): string {
  if (usd <= 0) return "$0.00 (within D1's free daily write allowance)";
  return `~$${usd.toFixed(4)} (over D1's free daily write allowance of ${D1_FREE_ROWS_WRITTEN_PER_DAY.toLocaleString()} rows)`;
}
