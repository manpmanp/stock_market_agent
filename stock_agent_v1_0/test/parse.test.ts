import { describe, expect, it } from "vitest";
import { parseFundamentals, parseIdentity, parsePriceHistory, parseValuation } from "../src/lib/parse.js";
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
});
