import { describe, expect, it } from "vitest";
import { buildLookup, checkGrounding, flattenNumeric, type DataBundle } from "../src/analyst/run.js";
import type { AnalystSynthesis } from "../src/analyst/types.js";

function baseBundle(): DataBundle {
  return {
    asOf: "2026-11-03T00:00:00.000Z",
    decisionRunAt: { short: "2026-11-03 06:00:00", medium: "2026-11-03 06:00:00", long: "2026-11-03 06:00:00" },
    tickers: {
      AAPL: {
        decisions: {
          long: {
            score: 78.4,
            confidence: 61.2,
            decision: "Buy",
            valuationStatus: "fair_value",
            entryStatus: "neutral",
            factorScores: { quality: 90, valuation: 55 },
            warnings: [],
          },
        },
        supportingMetrics: { trailingPe: 32.1, evToEbit: 28.6 },
      },
    },
    benchmarks: {
      SPY: { name: "S&P 500", regimeProxyFor: ["us"], trendState: "neutral", rsi14: 52.3, priceVsSma50: 0.02, priceVsSma200: 0.07 },
    },
  };
}

describe("flattenNumeric", () => {
  it("collects only numeric leaves, with dotted paths", () => {
    const out = flattenNumeric({ a: 1, b: { c: 2, d: "skip me" }, e: null, f: [1, 2, 3] });
    expect(out).toEqual({ a: 1, "b.c": 2 });
  });

  it("returns an empty object for a non-object input", () => {
    expect(flattenNumeric(null)).toEqual({});
    expect(flattenNumeric("x")).toEqual({});
  });
});

describe("buildLookup", () => {
  it("keys every numeric leaf by ticker::dotted.path, across both tickers and benchmarks", () => {
    const lookup = buildLookup(baseBundle());
    expect(lookup.get("AAPL::decisions.long.score")).toBe(78.4);
    expect(lookup.get("AAPL::decisions.long.factorScores.valuation")).toBe(55);
    expect(lookup.get("AAPL::supportingMetrics.trailingPe")).toBe(32.1);
    expect(lookup.get("SPY::rsi14")).toBe(52.3);
    // Non-numeric leaves (trendState, regimeProxyFor, decision labels) never appear.
    expect(lookup.has("SPY::trendState")).toBe(false);
    expect(lookup.has("AAPL::decisions.long.decision")).toBe(false);
  });
});

describe("checkGrounding", () => {
  const bundle = baseBundle();
  const lookup = buildLookup(bundle);

  function validSynthesis(): AnalystSynthesis {
    return {
      marketContext: "Broad market is neutral.",
      citations: [{ ticker: "SPY", metric: "rsi14", value: 52.3 }],
      picks: [
        {
          ticker: "AAPL",
          horizon: "long",
          stance: "watch",
          rationale: "Strong quality, fair valuation.",
          citations: [
            { ticker: "AAPL", metric: "decisions.long.factorScores.quality", value: 90 },
            { ticker: "AAPL", metric: "decisions.long.score", value: 78.4 },
          ],
        },
      ],
      warnings: [],
    };
  }

  it("returns no violations for a fully-grounded synthesis", () => {
    expect(checkGrounding(validSynthesis(), lookup, bundle)).toEqual([]);
  });

  it("flags a citation whose value doesn't match the real data", () => {
    const bad = validSynthesis();
    bad.picks[0]!.citations[0]!.value = 999; // real value is 90
    const violations = checkGrounding(bad, lookup, bundle);
    expect(violations.some((v) => v.includes("999") && v.includes("90"))).toBe(true);
  });

  it("flags a citation referencing a metric that doesn't exist in the data", () => {
    const bad = validSynthesis();
    bad.picks[0]!.citations[0]!.metric = "decisions.long.factorScores.madeUpFactor";
    const violations = checkGrounding(bad, lookup, bundle);
    expect(violations.some((v) => v.includes("does not exist"))).toBe(true);
  });

  it("flags a pick for a ticker not present in the supplied data", () => {
    const bad = validSynthesis();
    bad.picks[0]!.ticker = "NOTREAL";
    const violations = checkGrounding(bad, lookup, bundle);
    expect(violations.some((v) => v.includes("NOTREAL") && v.includes("not in the tracked universe"))).toBe(true);
  });

  it("flags a pick citing a horizon with no decision data for that ticker", () => {
    const bad = validSynthesis();
    bad.picks[0]!.horizon = "short"; // bundle only has a "long" decision for AAPL
    const violations = checkGrounding(bad, lookup, bundle);
    expect(violations.some((v) => v.includes('horizon "short"'))).toBe(true);
  });

  it("flags a pick with zero citations as ungrounded", () => {
    const bad = validSynthesis();
    bad.picks[0]!.citations = [];
    const violations = checkGrounding(bad, lookup, bundle);
    expect(violations.some((v) => v.includes("no citations"))).toBe(true);
  });

  it("flags marketContext with zero citations", () => {
    const bad = validSynthesis();
    bad.citations = [];
    const violations = checkGrounding(bad, lookup, bundle);
    expect(violations.some((v) => v.startsWith("marketContext"))).toBe(true);
  });

  it("tolerates tiny rounding differences (within the scaled tolerance) rather than flagging them", () => {
    const close = validSynthesis();
    close.picks[0]!.citations[1]!.value = 78.39; // real value is 78.4 -- within tolerance
    expect(checkGrounding(close, lookup, bundle)).toEqual([]);
  });
});
