import { describe, expect, it } from "vitest";
import {
  computeEvToEbit,
  computeFactorScores,
  computeInterestCoverage,
  computeNetDebtToEbitda,
  computeSupportingMetrics,
  marketRegimeFromIndicators,
  neutralMarketRegime,
  toFactorScores,
} from "../src/decision/factors.js";
import { FACTORS } from "../src/decision/types.js";
import type { UniverseSnapshotRow } from "../src/lib/db.js";
import type { TechnicalIndicators } from "../src/scoring/indicators.js";

function baseRow(overrides: Partial<UniverseSnapshotRow> = {}): UniverseSnapshotRow {
  return {
    ticker: "TEST",
    price: 100,
    trailing_pe: 20,
    peg_ratio: 1.5,
    fcf_yield: 0.05,
    gross_margin: 0.4,
    operating_margin: 0.2,
    net_margin: 0.15,
    return_on_equity: 0.2,
    revenue_growth_yoy: 0.1,
    earnings_growth_yoy: 0.1,
    debt_to_equity: 0.5,
    fair_value: 110,
    num_analysts: 10,
    rsi_14: 50,
    macd: 0.5,
    macd_signal: 0.3,
    price_vs_sma50: 0.02,
    price_vs_sma200: 0.05,
    volume_trend_20d: 1.1,
    dividend_yield: 0.02,
    volatility_30d: 0.25,
    price_range_pct: 0.5,
    dist_from_high_pct: -0.1,
    dist_from_low_pct: 0.2,
    trend_state: "neutral",
    ev_to_ebitda: 12,
    beta: 1.0,
    return_on_assets: 0.08,
    ebit: 20,
    ebitda: 25,
    enterprise_value: 200,
    total_debt: 50,
    total_cash: 30,
    interest_expense: 2,
    payout_ratio: 0.4,
    target_low: 90,
    target_high: 130,
    rating: "buy",
    rec_strong_buy: 5,
    rec_buy: 8,
    rec_hold: 3,
    rec_sell: 0,
    rec_strong_sell: 0,
    ...overrides,
  };
}

const neutralRegime = neutralMarketRegime("test placeholder");

describe("computeFactorScores", () => {
  it("returns all 10 factors, each in [0,100]", () => {
    const details = computeFactorScores(baseRow(), neutralRegime);
    for (const f of FACTORS) {
      expect(details[f]).toBeDefined();
      expect(details[f].value).toBeGreaterThanOrEqual(0);
      expect(details[f].value).toBeLessThanOrEqual(100);
    }
  });

  it("scores a strong-fundamentals row higher on quality than a weak one", () => {
    const strong = computeFactorScores(baseRow({ gross_margin: 0.6, operating_margin: 0.3, net_margin: 0.25, return_on_equity: 0.3 }), neutralRegime);
    const weak = computeFactorScores(baseRow({ gross_margin: 0.1, operating_margin: 0.02, net_margin: 0.01, return_on_equity: 0.02 }), neutralRegime);
    expect(strong.quality.value).toBeGreaterThan(weak.quality.value);
  });

  it("flags quality unscored when the underlying fundamentals are entirely missing", () => {
    const details = computeFactorScores(
      baseRow({ gross_margin: null, operating_margin: null, net_margin: null, return_on_equity: null, return_on_assets: null }),
      neutralRegime
    );
    expect(details.quality.unscored).toBe(true);
    expect(details.quality.value).toBe(50);
  });

  it("always flags catalyst unscored -- no data source exists for it", () => {
    const details = computeFactorScores(baseRow(), neutralRegime);
    expect(details.catalyst.unscored).toBe(true);
    expect(details.catalyst.value).toBe(50);
  });

  it("passes the supplied market_regime detail through unchanged", () => {
    const details = computeFactorScores(baseRow(), neutralRegime);
    expect(details.market_regime).toEqual(neutralRegime);
  });

  it("scores entry from trend_state, matching the direction of the v1 rankings engine's entry-timing read", () => {
    const pullback = computeFactorScores(baseRow({ trend_state: "pullback_in_uptrend" }), neutralRegime);
    const downtrend = computeFactorScores(baseRow({ trend_state: "downtrend" }), neutralRegime);
    expect(pullback.entry.value).toBeGreaterThan(downtrend.entry.value);
  });

  it("scores risk higher (lower risk) for a low-volatility, low-leverage row", () => {
    const safe = computeFactorScores(baseRow({ volatility_30d: 0.15, debt_to_equity: 0.2, dist_from_high_pct: -0.02 }), neutralRegime);
    const risky = computeFactorScores(baseRow({ volatility_30d: 0.6, debt_to_equity: 3, dist_from_high_pct: -0.6 }), neutralRegime);
    expect(safe.risk.value).toBeGreaterThan(risky.risk.value);
  });

  it("scores risk lower for a high-beta row than a low-beta row, all else equal", () => {
    const lowBeta = computeFactorScores(baseRow({ beta: 0.5 }), neutralRegime);
    const highBeta = computeFactorScores(baseRow({ beta: 2.5 }), neutralRegime);
    expect(lowBeta.risk.value).toBeGreaterThan(highBeta.risk.value);
  });

  it("scores financial strength higher for lower Net Debt/EBITDA and higher interest coverage", () => {
    const strong = computeFactorScores(baseRow({ total_debt: 10, total_cash: 40, ebitda: 30, ebit: 25, interest_expense: 1 }), neutralRegime);
    const weak = computeFactorScores(baseRow({ total_debt: 150, total_cash: 5, ebitda: 20, ebit: 8, interest_expense: 6 }), neutralRegime);
    expect(strong.financial_strength.value).toBeGreaterThan(weak.financial_strength.value);
  });

  it("scores valuation higher for a cheaper EV/EBIT, all else equal", () => {
    const cheap = computeFactorScores(baseRow({ enterprise_value: 100, ebit: 15 }), neutralRegime); // ~6.7x
    const expensive = computeFactorScores(baseRow({ enterprise_value: 800, ebit: 15 }), neutralRegime); // ~53x
    expect(cheap.valuation.value).toBeGreaterThan(expensive.valuation.value);
  });

  it("still scores valuation from the self-relative signals alone when EV/EBIT inputs are missing", () => {
    const details = computeFactorScores(baseRow({ enterprise_value: null, ebit: null }), neutralRegime);
    expect(details.valuation.unscored).toBe(false);
  });

  it("scores quality higher for a higher ROA, all else equal", () => {
    const highRoa = computeFactorScores(baseRow({ return_on_assets: 0.15 }), neutralRegime);
    const lowRoa = computeFactorScores(baseRow({ return_on_assets: 0.01 }), neutralRegime);
    expect(highRoa.quality.value).toBeGreaterThan(lowRoa.quality.value);
  });
});

describe("computeEvToEbit", () => {
  it("divides enterprise value by EBIT", () => {
    expect(computeEvToEbit(200, 20)).toBeCloseTo(10, 6);
  });
  it("returns null for missing or non-positive EBIT", () => {
    expect(computeEvToEbit(200, null)).toBeNull();
    expect(computeEvToEbit(200, 0)).toBeNull();
    expect(computeEvToEbit(200, -5)).toBeNull();
  });
});

describe("computeNetDebtToEbitda", () => {
  it("computes (debt - cash) / EBITDA, allowing a negative (net-cash) result", () => {
    expect(computeNetDebtToEbitda(50, 30, 25)).toBeCloseTo(0.8, 6);
    expect(computeNetDebtToEbitda(10, 40, 25)).toBeCloseTo(-1.2, 6);
  });
  it("returns null when EBITDA is missing or non-positive", () => {
    expect(computeNetDebtToEbitda(50, 30, null)).toBeNull();
    expect(computeNetDebtToEbitda(50, 30, 0)).toBeNull();
  });
});

describe("computeInterestCoverage", () => {
  it("divides EBIT by interest expense", () => {
    expect(computeInterestCoverage(20, 2)).toBeCloseTo(10, 6);
  });
  it("returns null when interest expense is missing or non-positive (treated as missing data, not zero debt cost)", () => {
    expect(computeInterestCoverage(20, null)).toBeNull();
    expect(computeInterestCoverage(20, 0)).toBeNull();
  });
});

describe("computeSupportingMetrics", () => {
  it("surfaces the raw display metrics without scoring or altering them", () => {
    const metrics = computeSupportingMetrics(baseRow());
    expect(metrics.currentPrice).toBe(100);
    expect(metrics.trailingPe).toBe(20);
    expect(metrics.evToEbitda).toBe(12);
    expect(metrics.evToEbit).toBeCloseTo(10, 6); // 200 / 20
    expect(metrics.netDebtToEbitda).toBeCloseTo(0.8, 6); // (50-30)/25
    expect(metrics.interestCoverage).toBeCloseTo(10, 6); // 20/2
    expect(metrics.beta).toBe(1.0);
    expect(metrics.returnOnAssets).toBe(0.08);
    expect(metrics.payoutRatio).toBe(0.4);
    expect(metrics.analyst.numAnalysts).toBe(10);
    expect(metrics.analyst.rating).toBe("buy");
    expect(metrics.analyst.targetMean).toBe(110); // fair_value doubles as the mean analyst target
    expect(metrics.analyst.recBuy).toBe(8);
  });
});

describe("toFactorScores", () => {
  it("flattens FactorScoreDetails to plain 0-100 numbers", () => {
    const details = computeFactorScores(baseRow(), neutralRegime);
    const flat = toFactorScores(details);
    for (const f of FACTORS) expect(flat[f]).toBe(details[f].value);
  });
});

describe("marketRegimeFromIndicators", () => {
  function indicators(overrides: Partial<TechnicalIndicators> = {}): TechnicalIndicators {
    return {
      asOfDate: "2026-08-28",
      rsi14: 50,
      macd: 0.1,
      macdSignal: 0.05,
      sma50: 100,
      sma100: 98,
      sma200: 95,
      priceVsSma50: 0.02,
      priceVsSma200: 0.05,
      volatility30d: 0.15,
      volumeTrend20d: 1,
      priceRangePercentile: 0.5,
      distFromHighPct: -0.05,
      distFromLowPct: 0.3,
      trendState: "neutral",
      ...overrides,
    };
  }

  it("scores an uptrending proxy above a downtrending one", () => {
    const up = marketRegimeFromIndicators(indicators({ priceVsSma50: 0.08, priceVsSma200: 0.12, rsi14: 60 }));
    const down = marketRegimeFromIndicators(indicators({ priceVsSma50: -0.08, priceVsSma200: -0.12, rsi14: 35 }));
    expect(up.unscored).toBe(false);
    expect(up.value).toBeGreaterThan(down.value);
  });

  it("falls back to a flagged-neutral placeholder when there's no usable indicator data", () => {
    const empty = marketRegimeFromIndicators(indicators({ priceVsSma50: null, priceVsSma200: null, rsi14: null }));
    expect(empty.unscored).toBe(true);
    expect(empty.value).toBe(50);
  });
});
