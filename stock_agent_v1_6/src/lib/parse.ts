import type {
  FundamentalsRecord,
  PriceBar,
  StockIdentity,
  ValuationRecord,
} from "./types.js";
import type { YahooChartResponse, YahooQuoteSummaryResponse } from "./yahoo.js";

function toISODate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** Parses a chart response into daily OHLCV bars. Returns [] on any missing/malformed data
 *  rather than throwing, so one bad ticker doesn't stop the whole ingestion run. */
export function parsePriceHistory(resp: YahooChartResponse | null): PriceBar[] {
  const result = resp?.chart?.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose;
  if (!quote) return [];

  const bars: PriceBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    if (ts === undefined) continue;
    bars.push({
      date: toISODate(ts),
      open: quote.open?.[i] ?? null,
      high: quote.high?.[i] ?? null,
      low: quote.low?.[i] ?? null,
      close: quote.close?.[i] ?? null,
      adjClose: adjClose?.[i] ?? quote.close?.[i] ?? null,
      volume: quote.volume?.[i] ?? null,
    });
  }
  return bars;
}

export interface ChartPoint {
  t: string; // full ISO timestamp (not truncated to date) -- intraday ranges need time-of-day
  close: number | null;
}

/** Like parsePriceHistory, but keeps the full timestamp (for intraday chart
 *  ranges) and only the field the /chart endpoint actually renders. Used
 *  for live on-demand chart snapshots, never written to D1. */
export function parseChartPoints(resp: YahooChartResponse | null): ChartPoint[] {
  const result = resp?.chart?.result?.[0];
  if (!result) return [];
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  if (!quote) return [];
  const points: ChartPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    if (ts === undefined) continue;
    points.push({ t: new Date(ts * 1000).toISOString(), close: quote.close?.[i] ?? null });
  }
  return points;
}

function raw(stat?: { raw?: number }): number | null {
  return typeof stat?.raw === "number" ? stat.raw : null;
}

export function parseIdentity(
  ticker: string,
  fallback: { exchange: string; region: string; currency: string },
  resp: YahooQuoteSummaryResponse | null
): StockIdentity {
  const r = resp?.quoteSummary?.result?.[0];
  return {
    ticker,
    exchange: r?.price?.exchangeName ?? fallback.exchange,
    isin: null, // not present on these Yahoo modules; left for a future source to fill in
    name: r?.price?.longName ?? r?.price?.shortName ?? null,
    sector: r?.assetProfile?.sector ?? null,
    industry: r?.assetProfile?.industry ?? null,
    currency: r?.price?.currency ?? fallback.currency,
    region: fallback.region,
  };
}

export function parseFundamentals(resp: YahooQuoteSummaryResponse | null): FundamentalsRecord | null {
  const r = resp?.quoteSummary?.result?.[0];
  if (!r) return null;

  const fcf = raw(r.financialData?.freeCashflow);
  const marketCap = raw(r.price?.marketCap);
  const fcfYield = fcf !== null && marketCap ? fcf / marketCap : null;

  // Most recent annual statement (index 0) -- see YahooQuoteSummaryResponse
  // doc comment on incomeStatementHistory.
  const latestIncomeStatement = r.incomeStatementHistory?.incomeStatementHistory?.[0];

  return {
    trailingPe: raw(r.summaryDetail?.trailingPE),
    forwardPe: raw(r.summaryDetail?.forwardPE),
    priceToBook: raw(r.defaultKeyStatistics?.priceToBook),
    priceToSales: raw(r.summaryDetail?.priceToSalesTrailing12Months),
    evToEbitda: raw(r.defaultKeyStatistics?.enterpriseToEbitda),
    dividendYield: raw(r.summaryDetail?.dividendYield),
    payoutRatio: raw(r.summaryDetail?.payoutRatio),
    revenueGrowthYoy: raw(r.financialData?.revenueGrowth),
    earningsGrowthYoy: raw(r.financialData?.earningsGrowth),
    grossMargin: raw(r.financialData?.grossMargins),
    operatingMargin: raw(r.financialData?.operatingMargins),
    netMargin: raw(r.financialData?.profitMargins),
    returnOnEquity: raw(r.financialData?.returnOnEquity),
    returnOnInvestedCapital: null, // Yahoo doesn't expose ROIC directly on these modules; left null (flagged as missing) in v1
    debtToEquity: raw(r.financialData?.debtToEquity),
    freeCashFlow: fcf,
    fcfYield,
    marketCap,
    pegRatio: raw(r.defaultKeyStatistics?.pegRatio),
    beta: raw(r.defaultKeyStatistics?.beta),
    returnOnAssets: raw(r.financialData?.returnOnAssets),
    ebit: raw(latestIncomeStatement?.operatingIncome),
    ebitda: raw(r.financialData?.ebitda),
    enterpriseValue: raw(r.defaultKeyStatistics?.enterpriseValue),
    totalDebt: raw(r.financialData?.totalDebt),
    totalCash: raw(r.financialData?.totalCash),
    interestExpense: raw(latestIncomeStatement?.interestExpense),
  };
}

export function parseValuation(resp: YahooQuoteSummaryResponse | null): ValuationRecord | null {
  const r = resp?.quoteSummary?.result?.[0];
  if (!r?.financialData) return null;

  // "0m" = current-month recommendation-trend snapshot; fall back to the
  // first entry if Yahoo ever omits the period label.
  const trend = r.recommendationTrend?.trend;
  const currentTrend = trend?.find((t) => t.period === "0m") ?? trend?.[0];

  return {
    source: "yahoo_finance",
    fairValue: raw(r.financialData.targetMeanPrice),
    targetPrice: raw(r.financialData.targetMeanPrice),
    targetLow: raw(r.financialData.targetLowPrice),
    targetHigh: raw(r.financialData.targetHighPrice),
    rating: r.financialData.recommendationKey ?? null,
    numAnalysts: raw(r.financialData.numberOfAnalystOpinions),
    recStrongBuy: currentTrend?.strongBuy ?? null,
    recBuy: currentTrend?.buy ?? null,
    recHold: currentTrend?.hold ?? null,
    recSell: currentTrend?.sell ?? null,
    recStrongSell: currentTrend?.strongSell ?? null,
  };
}
