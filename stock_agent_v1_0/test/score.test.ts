import { describe, expect, it } from "vitest";
import { scoreUniverse, topN, type UniverseRow } from "../src/scoring/score.js";

function baseRow(overrides: Partial<UniverseRow>): UniverseRow {
  return {
    ticker: "TEST",
    price: 100,
    trailingPe: 20,
    pegRatio: 1.5,
    fcfYield: 0.05,
    grossMargin: 0.4,
    operatingMargin: 0.2,
    netMargin: 0.15,
    returnOnEquity: 0.2,
    revenueGrowthYoy: 0.1,
    earningsGrowthYoy: 0.1,
    debtToEquity: 50,
    fairValue: 110,
    numAnalysts: 10,
    rsi14: 50,
    macd: 0.5,
    macdSignal: 0.3,
    priceVsSma50: 0.02,
    priceVsSma200: 0.05,
    volumeTrend20d: 1.1,
    ...overrides,
  };
}

describe("scoreUniverse", () => {
  it("excludes rows missing critical fields instead of scoring them", () => {
    const rows = [baseRow({ ticker: "GOOD" }), baseRow({ ticker: "NO_PRICE", price: null })];
    const scored = scoreUniverse(rows);
    const noPrice = scored.find((r) => r.ticker === "NO_PRICE");
    expect(noPrice?.excluded).toBe(true);
    expect(noPrice?.excludedReason).toMatch(/price/i);
    const good = scored.find((r) => r.ticker === "GOOD");
    expect(good?.excluded).toBe(false);
  });

  it("ranks a cheaper, higher-quality, higher-momentum stock above a worse one", () => {
    const cheap = baseRow({
      ticker: "CHEAP",
      trailingPe: 8,
      pegRatio: 0.8,
      fcfYield: 0.09,
      price: 80,
      fairValue: 120, // deeply undervalued vs analyst target
      returnOnEquity: 0.35,
      grossMargin: 0.6,
      rsi14: 50,
      priceVsSma50: 0.05,
      priceVsSma200: 0.1,
    });
    const expensive = baseRow({
      ticker: "EXPENSIVE",
      trailingPe: 60,
      pegRatio: 4,
      fcfYield: 0.005,
      price: 150,
      fairValue: 100, // overvalued vs analyst target
      returnOnEquity: 0.02,
      grossMargin: 0.1,
      rsi14: 80, // overbought
      priceVsSma50: -0.05,
      priceVsSma200: -0.1,
    });
    const scored = scoreUniverse([cheap, expensive]);
    const cheapScore = scored.find((r) => r.ticker === "CHEAP")!;
    const expensiveScore = scored.find((r) => r.ticker === "EXPENSIVE")!;
    expect(cheapScore.scores.long as number).toBeGreaterThan(expensiveScore.scores.long as number);
    expect(cheapScore.scores.short as number).toBeGreaterThan(expensiveScore.scores.short as number);
  });

  it("weights long-term toward quality/valuation and short-term toward momentum", () => {
    // Same valuation/quality, but one has strong momentum and the other doesn't.
    const hotMomentum = baseRow({ ticker: "HOT", rsi14: 50, priceVsSma50: 0.1, priceVsSma200: 0.2, volumeTrend20d: 1.8 });
    const coldMomentum = baseRow({ ticker: "COLD", rsi14: 50, priceVsSma50: -0.1, priceVsSma200: -0.2, volumeTrend20d: 0.6 });
    const scored = scoreUniverse([hotMomentum, coldMomentum]);
    const hot = scored.find((r) => r.ticker === "HOT")!;
    const cold = scored.find((r) => r.ticker === "COLD")!;
    const hotShortMinusLong = (hot.scores.short as number) - (hot.scores.long as number);
    const coldShortMinusLong = (cold.scores.short as number) - (cold.scores.long as number);
    // momentum should help HOT more on the short horizon than the long one, and hurt COLD more.
    expect(hotShortMinusLong).toBeGreaterThan(coldShortMinusLong);
  });

  it("topN returns at most n rows, sorted descending, excluding excluded rows", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      baseRow({ ticker: `T${i}`, trailingPe: 10 + i * 5 })
    );
    const scored = scoreUniverse(rows);
    const top2 = topN(scored, "long", 2);
    expect(top2).toHaveLength(2);
    expect(top2[0]!.scores.long as number).toBeGreaterThanOrEqual(top2[1]!.scores.long as number);
  });
});
