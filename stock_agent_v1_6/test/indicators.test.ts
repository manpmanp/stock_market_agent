import { describe, expect, it } from "vitest";
import { computeIndicators, type PricePoint } from "../src/scoring/indicators.js";

function makeSeries(n: number, start: number, dailyDrift: number): PricePoint[] {
  const points: PricePoint[] = [];
  let price = start;
  const base = new Date("2024-01-01T00:00:00Z").getTime();
  for (let i = 0; i < n; i++) {
    price = price * (1 + dailyDrift);
    points.push({
      date: new Date(base + i * 86400000).toISOString().slice(0, 10),
      close: Math.round(price * 100) / 100,
      volume: 1000000 + (i % 5) * 10000,
    });
  }
  return points;
}

describe("computeIndicators", () => {
  it("returns all nulls for an empty series", () => {
    const result = computeIndicators([]);
    expect(result.asOfDate).toBeNull();
    expect(result.rsi14).toBeNull();
    expect(result.sma50).toBeNull();
  });

  it("returns nulls for indicators that need more history than provided", () => {
    const short = makeSeries(10, 100, 0.001);
    const result = computeIndicators(short);
    expect(result.asOfDate).not.toBeNull();
    expect(result.sma50).toBeNull(); // needs 50 points
    expect(result.macd).toBeNull(); // needs ~35 points
  });

  it("computes SMA50/100/200 once enough history exists", () => {
    const long = makeSeries(260, 100, 0.0005);
    const result = computeIndicators(long);
    expect(result.sma50).not.toBeNull();
    expect(result.sma100).not.toBeNull();
    expect(result.sma200).not.toBeNull();
    // steadily rising series: price should sit above all its SMAs
    expect(result.priceVsSma50).toBeGreaterThan(0);
    expect(result.priceVsSma200).toBeGreaterThan(0);
  });

  it("RSI approaches 100 for a monotonically rising series and is bounded [0,100]", () => {
    const rising = makeSeries(30, 100, 0.02);
    const result = computeIndicators(rising);
    expect(result.rsi14).not.toBeNull();
    expect(result.rsi14 as number).toBeGreaterThan(90);
    expect(result.rsi14 as number).toBeLessThanOrEqual(100);
  });

  it("RSI approaches 0 for a monotonically falling series", () => {
    const falling = makeSeries(30, 100, -0.02);
    const result = computeIndicators(falling);
    expect(result.rsi14 as number).toBeLessThan(10);
  });

  it("volatility is null with insufficient history and non-negative once computed", () => {
    expect(computeIndicators(makeSeries(20, 100, 0.001)).volatility30d).toBeNull();
    const v = computeIndicators(makeSeries(100, 100, 0.001)).volatility30d;
    expect(v).not.toBeNull();
    expect(v as number).toBeGreaterThanOrEqual(0);
  });

  it("priceRangePercentile is near 1 at the top of a rising series and null with too little history", () => {
    expect(computeIndicators(makeSeries(20, 100, 0.01)).priceRangePercentile).toBeNull(); // <60 points
    const rising = computeIndicators(makeSeries(300, 100, 0.002));
    expect(rising.priceRangePercentile as number).toBeGreaterThan(0.9); // last close is the series max
  });

  it("flags a pullback within an uptrend distinctly from a genuine downtrend", () => {
    // Long steady uptrend, then a short recent dip -- price now below sma50
    // while sma50 is still above sma200.
    const uptrend = makeSeries(220, 50, 0.004);
    const dip = makeSeries(10, uptrend[uptrend.length - 1]!.close, -0.02).map((p, i) => ({
      ...p,
      date: new Date(new Date(uptrend[uptrend.length - 1]!.date).getTime() + (i + 1) * 86400000)
        .toISOString()
        .slice(0, 10),
    }));
    const pullback = computeIndicators([...uptrend, ...dip]);
    expect(pullback.trendState).toBe("pullback_in_uptrend");

    // A sustained decline long enough that both moving averages are falling.
    const downtrend = computeIndicators(makeSeries(260, 100, -0.004));
    expect(downtrend.trendState).toBe("downtrend");
  });
});
