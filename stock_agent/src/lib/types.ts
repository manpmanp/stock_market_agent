export interface Env {
  DB: D1Database;
  UNIVERSE_SOURCE?: string;
  /** Shared-secret gate for the manual /ingest, /score, /screen-broad-
   *  universe, and /market-analysis endpoints, set via `wrangler secret
   *  put ADMIN_TOKEN`. If unset, those endpoints refuse all requests
   *  rather than defaulting to open -- see README "Securing the manual
   *  endpoints". The scheduled cron handler bypasses this, since it isn't
   *  reached over HTTP. */
  ADMIN_TOKEN?: string;
  /** Anthropic API key for POST /market-analysis's LLM synthesis call
   *  (src/analyst/run.ts) -- set via `wrangler secret put
   *  ANTHROPIC_API_KEY`, same pattern as ADMIN_TOKEN. Unset means that one
   *  endpoint refuses (clearly, not silently) rather than making an
   *  unauthenticated call to api.anthropic.com. No other part of this
   *  project calls any LLM, so this key is scoped to exactly one feature. */
  ANTHROPIC_API_KEY?: string;
  /** Which Anthropic model /market-analysis calls, e.g. a current Sonnet
   *  model id -- deliberately NOT hardcoded with a fallback default:
   *  Anthropic model ids change over time, and silently falling back to
   *  one typed into this file months ago risks calling a deprecated or
   *  wrong model without anyone noticing. Set via `wrangler secret put
   *  ANTHROPIC_MODEL` (or a plain [vars] entry, if you don't consider the
   *  model name itself sensitive) to whatever current model id you want
   *  billed against your own Anthropic Console spend limit. */
  ANTHROPIC_MODEL?: string;
  /** GitHub PAT (fine-grained, "Actions: write" / classic with "workflow"
   *  scope) used only by POST /trigger-backtest to kick off the
   *  backtest.yml GitHub Actions workflow on demand (workflow_dispatch),
   *  the same workflow that already runs weekly on its own schedule --
   *  set via `wrangler secret put GITHUB_TOKEN`. Scoped to exactly this
   *  one repo if you can (fine-grained PAT); unset means that one
   *  endpoint refuses rather than silently doing nothing. Nothing else
   *  in this project talks to the GitHub API. */
  GITHUB_TOKEN?: string;
  /** R2 bucket serving static assets via GET /assets/<key> (src/lib/
   *  assets.ts) -- currently just the three Decision Lab demo videos
   *  (src/decisionLab.ts's Methodology -> Demos tab). Optional: a deploy
   *  that hasn't created/bound the bucket yet still works everywhere
   *  else, with /assets/* returning a clear 503 instead of crashing. See
   *  README "Demo videos" for how to create the bucket, bind it in
   *  wrangler.toml, and upload the video files. */
  ASSETS?: R2Bucket;
}

export interface UniverseEntry {
  ticker: string;
  exchange: string;
  region:
    | "nordic"
    | "nordic_ex_sweden"
    | "us"
    | "uk"
    | "germany"
    | "switzerland"
    | "europe"
    | "japan"
    | "emerging_markets"
    | "global";
  currency: string;
}

export interface PriceBar {
  date: string; // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  adjClose: number | null;
  volume: number | null;
}

export interface FundamentalsRecord {
  trailingPe: number | null;
  forwardPe: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  evToEbitda: number | null;
  dividendYield: number | null;
  payoutRatio: number | null;
  revenueGrowthYoy: number | null;
  earningsGrowthYoy: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  returnOnEquity: number | null;
  returnOnInvestedCapital: number | null;
  debtToEquity: number | null;
  freeCashFlow: number | null;
  fcfYield: number | null;
  marketCap: number | null;
  pegRatio: number | null;
  // Added for the decision engine's EV/EBIT, Net Debt/EBITDA, interest
  // coverage, Beta, and ROA cross-checks (src/decision/factors.ts) --
  // stored raw, ratios derived at read time. See migration 0006.
  beta: number | null;
  returnOnAssets: number | null;
  ebit: number | null; // operating income, most recent annual -- used as an EBIT proxy
  ebitda: number | null;
  enterpriseValue: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  interestExpense: number | null; // most recent annual, positive magnitude
}

export interface ValuationRecord {
  source: string;
  fairValue: number | null;
  targetPrice: number | null;
  targetLow: number | null;
  targetHigh: number | null;
  rating: string | null;
  numAnalysts: number | null;
  // Current-month analyst recommendation-trend breakdown -- a cross-check
  // shown alongside the decision engine's own read, never blended into
  // the weighted score. See migration 0006.
  recStrongBuy: number | null;
  recBuy: number | null;
  recHold: number | null;
  recSell: number | null;
  recStrongSell: number | null;
}

export interface StockIdentity {
  ticker: string;
  exchange: string;
  isin: string | null;
  name: string | null;
  sector: string | null;
  industry: string | null;
  currency: string;
  region: string;
}
