import { describe, expect, it } from "vitest";
import { parseChartPoints, parseFundamentals, parseIdentity, parsePriceHistory, parseValuation } from "../src/lib/parse.js";
import type { YahooChartResponse, YahooQuoteSummaryResponse } from "../src/lib/yahoo.js";
import chartFixture from "./fixtures/chart_aapl.json";
import quoteSummaryFixture from "./fixtures/quotesummary_aapl.json";

const chart = chartFixture as unknown as YahooChartResponse;
const quoteSummary = quoteSummaryFixture as unknown as YahooQuoteSummaryResponse;

describe("parsePriceHistory", () => {
  it("parses OHLCV bars with ISO dates", () => {
    const bars = parsePriceHistory(chart);
    expect(bars).toHaveLength(5);
    expect(bars[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bars[4]?.close).toBe(193.8);
    expect(bars[0]?.volume).toBe(55000000);
  });

  it("returns [] for a null/empty response instead of throwing", () => {
    expect(parsePriceHistory(null)).toEqual([]);
    expect(parsePriceHistory({ chart: { result: [], error: null } } as YahooChartResponse)).toEqual([]);
  });
});

describe("parseChartPoints", () => {
  it("keeps full ISO timestamps (not truncated to date) for intraday charting", () => {
    const points = parseChartPoints(chart);
    expect(points).toHaveLength(5);
    expect(points[0]?.t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(points[4]?.close).toBe(193.8);
  });

  it("returns [] for a null/empty response instead of throwing", () => {
    expect(parseChartPoints(null)).toEqual([]);
  });
});

describe("parseIdentity", () => {
  it("prefers Yahoo's fields but falls back to the universe config", () => {
    const id = parseIdentity("AAPL", { exchange: "NASDAQ", region: "us", currency: "USD" }, quoteSummary);
    expect(id.name).toBe("Apple Inc.");
    expect(id.sector).toBe("Technology");
    expect(id.currency).toBe("USD");
    expect(id.region).toBe("us");
  });

  it("falls back cleanly when quoteSummary is null", () => {
    const id = parseIdentity("XYZ", { exchange: "NYSE", region: "us", currency: "USD" }, null);
    expect(id.exchange).toBe("NYSE");
    expect(id.name).toBeNull();
  });
});

describe("parseFundamentals", () => {
  it("extracts raw numeric fields and derives fcfYield from FCF / market cap", () => {
    const f = parseFundamentals(quoteSummary);
    expect(f).not.toBeNull();
    expect(f?.trailingPe).toBe(30.5);
    expect(f?.pegRatio).toBe(2.9);
    expect(f?.marketCap).toBe(3000000000000);
    expect(f?.fcfYield).toBeCloseTo(90000000000 / 3000000000000, 6);
    expect(f?.returnOnInvestedCapital).toBeNull(); // known v1 gap, see parse.ts comment
  });

  it("extracts beta, ROA, and EV/EBIT/Net-Debt/EBITDA inputs, including EBIT from the income statement module", () => {
    const f = parseFundamentals(quoteSummary);
    expect(f?.beta).toBe(1.25);
    expect(f?.returnOnAssets).toBe(0.28);
    expect(f?.enterpriseValue).toBe(3050000000000);
    expect(f?.ebitda).toBe(130000000000);
    expect(f?.totalDebt).toBe(110000000000);
    expect(f?.totalCash).toBe(60000000000);
    // From the most recent (first) entry in incomeStatementHistory, not summaryDetail/financialData.
    expect(f?.ebit).toBe(115000000000);
    expect(f?.interestExpense).toBe(4000000000);
  });

  it("returns null when there's no result at all", () => {
    expect(parseFundamentals(null)).toBeNull();
  });
});

describe("parseValuation", () => {
  it("extracts analyst target price fields", () => {
    const v = parseValuation(quoteSummary);
    expect(v?.fairValue).toBe(210.0);
    expect(v?.targetLow).toBe(180.0);
    expect(v?.targetHigh).toBe(250.0);
    expect(v?.rating).toBe("buy");
    expect(v?.numAnalysts).toBe(42);
    expect(v?.source).toBe("yahoo_finance");
  });

  it("extracts the current-month (0m) analyst recommendation-trend breakdown", () => {
    const v = parseValuation(quoteSummary);
    expect(v?.recStrongBuy).toBe(15);
    expect(v?.recBuy).toBe(20);
    expect(v?.recHold).toBe(8);
    expect(v?.recSell).toBe(1);
    expect(v?.recStrongSell).toBe(0);
  });
});
