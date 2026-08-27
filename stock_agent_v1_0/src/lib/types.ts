export interface Env {
  DB: D1Database;
  UNIVERSE_SOURCE?: string;
  /** Shared-secret gate for the manual /ingest and /score endpoints, set via
   *  `wrangler secret put ADMIN_TOKEN`. If unset, those endpoints refuse all
   *  requests rather than defaulting to open -- see README "Securing the
   *  manual endpoints". The scheduled cron handler bypasses this, since it
   *  isn't reached over HTTP. */
  ADMIN_TOKEN?: string;
}

export interface UniverseEntry {
  ticker: string;
  exchange: string;
  region: "nordic" | "us" | "global";
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
}

export interface ValuationRecord {
  source: string;
  fairValue: number | null;
  targetPrice: number | null;
  targetLow: number | null;
  targetHigh: number | null;
  rating: string | null;
  numAnalysts: number | null;
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
