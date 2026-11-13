import { describe, expect, it } from "vitest";
import {
  regionOf, shownRows,
  capitalCagr, computeAll, entryStatus, marginOfSafety, scenarioReturns, trapChecklist, upside, weightedFairValue,
} from "../../src/garp/valuation.js";
import type { Facts, ResearchFile, ValuationInput } from "../../src/garp/types.js";

const f = (value: number | null) => ({ value });

function facts(over: Partial<Facts> = {}): Facts {
  return {
    price: f(80), high52w: f(100), low52w: f(70), marketCap: f(1000), netDebt: f(100), enterpriseValue: f(1100),
    peTrailing: f(20), peForward: f(18), evEbitTrailing: f(16), evEbitForward: f(15), evEbitdaTrailing: f(12),
    fcfTTM: f(50), fcfYield: f(0.05), dividendPerShare: f(2), dividendYield: f(0.025), payoutRatio: f(0.5),
    netDebtToEbitda: f(1.2), interestCoverage: f(15), roic: f(0.15), roe: f(0.2), beta5y: f(0.8),
    history: [
      { period: "FY2021", revenue: 100, ebit: 15, ebitMargin: 0.15, eps: 1, fcf: 12 },
      { period: "FY2022", revenue: 110, ebit: 17, ebitMargin: 0.155, eps: 1.1, fcf: 13 },
      { period: "FY2023", revenue: 121, ebit: 19, ebitMargin: 0.157, eps: 1.2, fcf: 15 },
      { period: "FY2024", revenue: 130, ebit: 21, ebitMargin: 0.16, eps: 1.3, fcf: 17 },
    ],
    consensus: { rating: "buy", analysts: 10, targetAvg: 100, targetHigh: 120, targetLow: 80, source: "x", asOf: "2026-11-12" },
    recentEvents: [], valueTrapFlags: [], dataGaps: [],
    ...over,
  };
}

function val(over: Partial<ValuationInput> = {}): ValuationInput {
  return {
    asOf: "2026-11-13", kind: "standard", method: "test", metricBasis: "EPS", basisValue: 4, forwardDividendYield: 0.025,
    qualityTier: "A", role: "Defensive Compounder", competitive: "stable",
    scores: { quality: 5, growth: 3, financialStrength: 5, risk: 4 },
    scenarios: {
      bear: { prob: 0.25, fairValue: 70, epsCagr5y: 0.02, exitPe5y: 16, note: "" },
      base: { prob: 0.5, fairValue: 100, epsCagr5y: 0.07, exitPe5y: 20, note: "" },
      bull: { prob: 0.25, fairValue: 130, epsCagr5y: 0.1, exitPe5y: 24, note: "" },
    },
    whyItFits: "", growthDrivers: "", saturation: "", principalRisk: "",
    ...over,
  };
}

describe("core formulas", () => {
  it("margin of safety and upside match the master prompt definitions", () => {
    expect(marginOfSafety(80, 100)).toBeCloseTo(0.2);
    expect(upside(80, 100)).toBeCloseTo(0.25);
  });

  it("weights scenarios and rejects probabilities that do not sum to 1", () => {
    expect(weightedFairValue(val().scenarios)).toBeCloseTo(100);
    const bad = val().scenarios;
    bad.bull = { ...bad.bull, prob: 0.3 };
    expect(() => weightedFairValue(bad)).toThrow();
  });

  it("capital CAGR: flat earnings and flat multiple give zero", () => {
    expect(capitalCagr(80, 4, 0, 20, 5)).toBeCloseTo(0);
    expect(capitalCagr(80, 4, 0.1, 20, 5)).toBeCloseTo(0.1);
  });

  it("separates capital and dividend return", () => {
    const r = scenarioReturns(80, val(), 5)!;
    expect(r.dividend).toBeCloseTo(0.025);
    expect(r.total).toBeCloseTo(r.capital + r.dividend);
    expect(scenarioReturns(80, val(), 10)).toBeNull();
  });

  it("entry status thresholds", () => {
    expect(entryStatus(79, 100, 0.2)).toBe("BUY ZONE");
    expect(entryStatus(88, 100, 0.2)).toBe("NEAR ENTRY");
    expect(entryStatus(95, 100, 0.2)).toBe("BELOW FAIR VALUE");
    expect(entryStatus(101, 100, 0.2)).toBe("ABOVE FAIR VALUE");
  });
});

describe("value-trap checklist", () => {
  it("healthy business is all green", () => {
    const lights = trapChecklist(facts(), val()).map((c) => c.light);
    expect(lights.every((l) => l === "green")).toBe(true);
  });

  it("flags expected earnings deterioration, leverage and margin compression", () => {
    const bad = facts({
      evEbitForward: f(22),
      netDebtToEbitda: f(4),
      history: [
        { period: "FY2021", revenue: 130, ebit: 26, ebitMargin: 0.2, eps: 1, fcf: 5 },
        { period: "FY2022", revenue: 120, ebit: 20, ebitMargin: 0.17, eps: 1, fcf: 4 },
        { period: "FY2023", revenue: 110, ebit: 13, ebitMargin: 0.12, eps: 1, fcf: 3 },
      ],
    });
    const byName = Object.fromEntries(trapChecklist(bad, val()).map((c) => [c.indicator, c.light]));
    expect(byName["Forward vs trailing"]).toBe("red");
    expect(byName["Net debt/EBITDA"]).toBe("red");
    expect(byName["Operating margin"]).toBe("red");
    expect(byName["Revenue trend"]).toBe("red");
    expect(byName["FCF conversion"]).toBe("red");
  });

  it("never compares EV/EBIT with P/E when a forward EV/EBIT is missing", () => {
    const c = trapChecklist(facts({ evEbitTrailing: f(8), evEbitForward: f(null), peTrailing: f(12), peForward: f(12.5) }), val());
    const fwd = c.find((x) => x.indicator === "Forward vs trailing")!;
    expect(fwd.light).toBe("green");
    expect(fwd.detail).toContain("P/E");
  });

  it("does not apply leverage/margin checks to banks and holding companies", () => {
    const byName = Object.fromEntries(trapChecklist(facts(), val({ kind: "holding" })).map((c) => [c.indicator, c.light]));
    expect(byName["Net debt/EBITDA"]).toBe("na");
    expect(byName["ROIC vs WACC"]).toBe("na");
  });
});

describe("ranking", () => {
  it("ranks cheaper identical business higher and requires a verified price", () => {
    const mk = (t: string, price: number): ResearchFile => ({
      ticker: t, name: t, exchange: "X", currency: "SEK", sector: "", businessSummary: "", retrievedAt: "",
      facts: facts({ price: f(price) }), valuation: val(),
    });
    const rows = computeAll([mk("DEAR", 110), mk("CHEAP", 75)]);
    expect(rows[0]!.ticker).toBe("CHEAP");
    expect(rows[0]!.rank).toBe(1);
    expect(() => computeAll([mk("NOPRICE", 0)])).toThrow();
  });
});

describe("regions and top-N", () => {
  const mk = (t: string, price: number): ResearchFile => ({
    ticker: t, name: t, exchange: "X", currency: "SEK", sector: "", businessSummary: "", retrievedAt: "",
    facts: facts({ price: f(price) }), valuation: val(),
  });
  it("derives region from the exchange suffix", () => {
    expect(regionOf(mk("ASSA-B.ST", 1))).toBe("nordic");
    expect(regionOf(mk("ORK.OL", 1))).toBe("nordic");
    expect(regionOf(mk("NESN.SW", 1))).toBe("global");
    expect(regionOf(mk("MSFT", 1))).toBe("global");
  });
  it("ranks within region and shows only the top N of each", () => {
    const files = [
      ...[70, 75, 80, 85, 90, 95, 99].map((p, i) => mk(`N${i}.ST`, p)),
      ...[72, 78, 84].map((p, i) => mk(`G${i}`, p)),
    ];
    const rows = computeAll(files);
    const shown = shownRows(rows, 5);
    expect(shown.filter((r) => r.region === "nordic").map((r) => r.ticker)).toEqual(["N0.ST", "N1.ST", "N2.ST", "N3.ST", "N4.ST"]);
    expect(shown.filter((r) => r.region === "global")).toHaveLength(3);
  });
});
