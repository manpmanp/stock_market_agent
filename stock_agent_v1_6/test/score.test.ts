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
    debtToEquity: 0.5,
    fairValue: 110,
    numAnalysts: 10,
    rsi14: 50,
    macd: 0.5,
    macdSignal: 0.3,
    priceVsSma50: 0.02,
    priceVsSma200: 0.05,
    volumeTrend20d: 1.1,
    dividendYield: 0.02,
    volatility30d: 0.25,
    priceRangePercentile: 0.5,
    distFromHighPct: -0.1,
    distFromLowPct: 0.2,
    trendState: "neutral",
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

  it("scores a stock purely from its own data -- unaffected by any other row in the universe", () => {
    const cheap = baseRow({
      ticker: "CHEAP",
      price: 80,
      fairValue: 120,
      priceRangePercentile: 0.1, // near its own 5y low
      returnOnEquity: 0.35,
      grossMargin: 0.6,
    });
    // Score it alone...
    const [aloneScore] = scoreUniverse([cheap]);
    // ...and alongside a very different stock. If scoring were still
    // cross-sectional this would change CHEAP's numbers; it must not.
    const noisyPeer = baseRow({
      ticker: "EXPENSIVE",
      price: 500,
      fairValue: 50,
      priceRangePercentile: 0.99,
      returnOnEquity: -0.5,
      grossMargin: 0.01,
      trendState: "downtrend",
    });
    const [withPeer] = scoreUniverse([cheap, noisyPeer]);
    expect(withPeer!.scores.long).toBe(aloneScore!.scores.long);
    expect(withPeer!.scores.short).toBe(aloneScore!.scores.short);
    expect(withPeer!.valuationScore).toBe(aloneScore!.valuationScore);
    expect(withPeer!.qualityScore).toBe(aloneScore!.qualityScore);
  });

  it("labels a stock undervalued when it's cheap vs. its own range and fair value, regardless of the rest of the universe", () => {
    const cheap = baseRow({
      ticker: "CHEAP",
      price: 80,
      fairValue: 120,
      priceRangePercentile: 0.05,
    });
    const scored = scoreUniverse([cheap]);
    expect(scored[0]!.valuationLabel).toBe("undervalued");
  });

  it("labels a stock overvalued when it's expensive vs. its own range and fair value", () => {
    const expensive = baseRow({
      ticker: "EXPENSIVE",
      price: 150,
      fairValue: 100,
      priceRangePercentile: 0.95,
    });
    const scored = scoreUniverse([expensive]);
    expect(scored[0]!.valuationLabel).toBe("overvalued");
  });

  it("weights long-term toward quality/valuation and short-term toward entry timing", () => {
    const goodEntry = baseRow({ ticker: "HOT", trendState: "pullback_in_uptrend" });
    const badEntry = baseRow({ ticker: "COLD", trendState: "downtrend" });
    const scored = scoreUniverse([goodEntry, badEntry]);
    const hot = scored.find((r) => r.ticker === "HOT")!;
    const cold = scored.find((r) => r.ticker === "COLD")!;
    const hotShortMinusLong = (hot.scores.short as number) - (hot.scores.long as number);
    const coldShortMinusLong = (cold.scores.short as number) - (cold.scores.long as number);
    expect(hotShortMinusLong).toBeGreaterThan(coldShortMinusLong);
  });

  it("classifies growth vs defensive style from fixed thresholds on this stock's own figures", () => {
    const growthy = baseRow({
      ticker: "GROWTH",
      revenueGrowthYoy: 0.35,
      earningsGrowthYoy: 0.4,
      dividendYield: 0,
      volatility30d: 0.5,
    });
    const defensive = baseRow({
      ticker: "DEFENSIVE",
      revenueGrowthYoy: 0.02,
      earningsGrowthYoy: 0.01,
      dividendYield: 0.05,
      volatility30d: 0.1,
    });

    // Each classified alone -- no other row should be able to change the result.
    expect(scoreUniverse([growthy])[0]?.style).toBe("growth");
    expect(scoreUniverse([defensive])[0]?.style).toBe("defensive");
  });

  it("gives excluded rows a null style rather than guessing", () => {
    const scored = scoreUniverse([baseRow({ ticker: "NO_PRICE", price: null })]);
    expect(scored[0]?.style).toBeNull();
  });

  it("topN sorts by each stock's own score, at most n rows, excluding excluded rows", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      baseRow({ ticker: `T${i}`, priceRangePercentile: i / 10 })
    );
    const scored = scoreUniverse(rows);
    const top2 = topN(scored, "long", 2);
    expect(top2).toHaveLength(2);
    expect(top2[0]!.scores.long as number).toBeGreaterThanOrEqual(top2[1]!.scores.long as number);
  });
});
