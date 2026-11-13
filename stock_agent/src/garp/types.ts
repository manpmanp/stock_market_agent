// GARP checker types. Self-contained: imports nothing from the agent's
// scoring/decision code and writes nothing the agent reads. Research input
// lives in config/garp/research/<TICKER>.json (facts from verification
// agents, valuation assumptions from the lead analyst); everything numeric
// that follows from those inputs is computed by valuation.ts.

export interface Field {
  value: number | null;
  period?: string;
  source?: string;
  asOf?: string;
  note?: string;
}

export interface HistoryRow {
  period: string;
  revenue: number | null;
  ebit: number | null;
  ebitMargin: number | null;
  eps: number | null;
  fcf: number | null;
  source?: string;
}

export interface Consensus {
  rating: string;
  analysts: number | null;
  buy?: number | null;
  hold?: number | null;
  sell?: number | null;
  targetAvg: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  source: string;
  asOf: string;
}

export interface Facts {
  price: Field;
  high52w: Field;
  low52w: Field;
  marketCap: Field;
  netDebt: Field;
  enterpriseValue: Field;
  peTrailing: Field;
  peForward: Field;
  evEbitTrailing: Field;
  evEbitForward: Field;
  evEbitdaTrailing: Field;
  fcfTTM: Field;
  fcfYield: Field;
  dividendPerShare: Field;
  dividendYield: Field;
  payoutRatio: Field;
  netDebtToEbitda: Field;
  interestCoverage: Field;
  roic: Field;
  roe: Field;
  beta5y: Field;
  sectorMetrics?: Record<string, Field>;
  history: HistoryRow[];
  historicalMultiples?: {
    peLow: number | null;
    peHigh: number | null;
    peMedian: number | null;
    evEbitMedian: number | null;
    years: string;
    source: string;
  };
  consensus: Consensus;
  forwardEstimates?: Record<string, unknown>;
  recentEvents: string[];
  valueTrapFlags: string[];
  dataGaps: string[];
  [extra: string]: unknown;
}

export interface Scenario {
  prob: number; // 0..1, the three must sum to 1
  fairValue: number; // per share, trading currency, today's value
  epsCagr5y: number; // decimal, used for the 2-5y return estimate
  exitPe5y: number; // P/E (or P/NAV, P/B for special sectors, see metricBasis)
  epsCagr10y?: number; // optional 5-10y estimate
  exitPe10y?: number;
  note: string;
}

export type QualityTier = "A" | "B" | "C";
export type Role = "Core Growth Engine" | "Defensive Compounder" | "Value Recovery" | "Dividend & Stability";
export type Competitive = "strengthening" | "stable" | "weakening";

export interface ValuationInput {
  asOf: string;
  kind: "standard" | "bank" | "holding";
  method: string; // how the fair values were derived
  metricBasis: string; // e.g. "EPS (adjusted, FY2026E normalized)" or "NAV per share"
  basisValue: number; // current per-share earnings (or NAV/book) the scenarios grow from
  forwardDividendYield: number; // decimal, assumed constant
  qualityTier: QualityTier;
  role: Role | null;
  competitive: Competitive;
  scores: { quality: number; growth: number; financialStrength: number; risk: number }; // 1-5, risk 5 = lowest risk
  scenarios: { bear: Scenario; base: Scenario; bull: Scenario };
  whyItFits: string;
  growthDrivers: string;
  saturation: string;
  principalRisk: string;
}

export type Region = "nordic" | "global";

export interface ResearchFile {
  ticker: string;
  region?: Region; // optional; derived from the exchange suffix when absent
  name: string;
  exchange: string;
  currency: string;
  sector: string;
  businessSummary: string;
  retrievedAt: string;
  facts: Facts;
  valuation?: ValuationInput;
}

export type Light = "green" | "amber" | "red" | "na";

export interface TrapCheck {
  indicator: string;
  light: Light;
  detail: string;
}

export type EntryStatus = "BUY ZONE" | "NEAR ENTRY" | "BELOW FAIR VALUE" | "ABOVE FAIR VALUE";

export interface Computed {
  ticker: string;
  name: string;
  currency: string;
  price: number;
  weightedFairValue: number;
  marginOfSafety: number; // 1 - price / fair value
  upside: number; // fair value / price - 1
  bearDownside: number; // bear value / price - 1
  requiredMarginOfSafety: number;
  entryPrice: number;
  accumulateLow: number;
  accumulateHigh: number;
  entryStatus: EntryStatus;
  return5y: { capital: number; dividend: number; total: number; byScenario: Record<"bear" | "base" | "bull", number> };
  return10y: { capital: number; dividend: number; total: number } | null;
  pctOf52wHigh: number | null;
  trap: TrapCheck[];
  trapReds: number;
  composite: number; // 0-100
  rank: number; // across all researched stocks
  region: Region;
  regionRank: number; // within its region; the report shows regionRank <= TOP_N[region]
}

export interface Conclusion {
  asOf: string;
  picks: Array<{ category: string; ticker: string | null; why: string; risk: string }>;
  watchNotBuy: Array<{ ticker: string; why: string }>;
}
