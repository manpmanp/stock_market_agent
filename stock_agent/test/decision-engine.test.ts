import { describe, expect, it } from "vitest";
import {
  buildWarnings,
  entryStatus,
  evaluateHorizon,
  overallView,
  perturbWeights,
  sensitivityTable,
  validateScores,
  validateWeights,
  valuationMetrics,
  valuationStatus,
  weightedScore,
} from "../src/decision/engine.js";
import { DEFAULT_WEIGHTS, FACTORS, type FactorScores, type WeightVector } from "../src/decision/types.js";

function evenScores(value = 60): FactorScores {
  const out = {} as FactorScores;
  for (const f of FACTORS) out[f] = value;
  return out;
}

describe("validateWeights", () => {
  it("accepts a vector that sums to 1", () => {
    expect(validateWeights(DEFAULT_WEIGHTS.long)).toBeNull();
  });
  it("rejects a vector that doesn't sum to 1", () => {
    const bad = { ...DEFAULT_WEIGHTS.long, quality: 0.9 };
    expect(validateWeights(bad)).toMatch(/sum to 1/);
  });
  it("rejects negative weights", () => {
    const bad = { ...DEFAULT_WEIGHTS.long, quality: -0.1 };
    expect(validateWeights(bad)).toMatch(/negative/);
  });
  it("rejects a vector missing a factor", () => {
    const bad = { ...DEFAULT_WEIGHTS.long } as Partial<WeightVector>;
    delete bad.quality;
    expect(validateWeights(bad as WeightVector)).toMatch(/missing/);
  });
});

describe("validateScores", () => {
  it("accepts scores in [0,100]", () => {
    expect(validateScores(evenScores(50))).toBeNull();
  });
  it("rejects an out-of-range score", () => {
    expect(validateScores(evenScores(150))).toMatch(/between 0 and 100/);
  });
});

describe("weightedScore", () => {
  it("returns the constant when every factor has the same score", () => {
    expect(weightedScore(evenScores(70), DEFAULT_WEIGHTS.long)).toBeCloseTo(70, 6);
  });
  it("renormalizes an unnormalized weight vector", () => {
    const w = { ...DEFAULT_WEIGHTS.long };
    // Doubling every weight shouldn't change the result -- weightedScore
    // renormalizes by the actual weight sum, not assuming callers pre-sum to 1.
    const doubled = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v * 2])) as WeightVector;
    expect(weightedScore(evenScores(70), doubled)).toBeCloseTo(weightedScore(evenScores(70), w), 6);
  });
});

describe("perturbWeights", () => {
  it("nudges the target factor and proportionally rescales the rest to still sum to 1", () => {
    const out = perturbWeights(DEFAULT_WEIGHTS.long, "quality", 0.05);
    expect(out).not.toBeNull();
    const sum = FACTORS.reduce((a, f) => a + (out as WeightVector)[f], 0);
    expect(sum).toBeCloseTo(1, 6);
    expect((out as WeightVector).quality).toBeCloseTo(DEFAULT_WEIGHTS.long.quality + 0.05, 6);
  });

  // This is exactly the case that crashed the uploaded example.py: nudging a
  // small weight (e.g. long-horizon "technical" at 0.03) down by 0.05 would
  // push it negative. The Python's own sensitivity_table() already caught
  // this and stored None; the bug was example.py's print loop not handling
  // None. Here the fix is at the source: return null, and every caller
  // (sensitivityTable, run.ts) is typed to handle it.
  it("returns null instead of throwing when a perturbation would go negative", () => {
    expect(perturbWeights(DEFAULT_WEIGHTS.long, "technical", -0.05)).toBeNull();
    expect(perturbWeights(DEFAULT_WEIGHTS.long, "entry", -0.05)).toBeNull();
    expect(perturbWeights(DEFAULT_WEIGHTS.long, "catalyst", -0.05)).toBeNull();
  });
});

describe("sensitivityTable", () => {
  it("never throws, even for factors whose weight can't be perturbed down", () => {
    expect(() => sensitivityTable(evenScores(60), DEFAULT_WEIGHTS.long)).not.toThrow();
  });
  it("reports null (not a crash) for a minus-perturbation that would go negative", () => {
    const table = sensitivityTable(evenScores(60), DEFAULT_WEIGHTS.long);
    expect(table.technical.minus).toBeNull();
    expect(table.technical.plus).not.toBeNull();
  });
});

describe("valuationStatus", () => {
  it("classifies deep undervaluation, fair value, and overvaluation", () => {
    expect(valuationStatus(60, 100)).toBe("DEEPLY_UNDERVALUED");
    expect(valuationStatus(100, 100)).toBe("FAIRLY_VALUED");
    expect(valuationStatus(150, 100)).toBe("VERY_EXPENSIVE");
  });
  it("returns UNKNOWN when price or fair value is missing", () => {
    expect(valuationStatus(null, 100)).toBe("UNKNOWN");
    expect(valuationStatus(100, null)).toBe("UNKNOWN");
  });
});

describe("entryStatus", () => {
  it("maps score bands to labels", () => {
    expect(entryStatus(90)).toBe("EXCELLENT_ENTRY");
    expect(entryStatus(72)).toBe("GOOD_ENTRY");
    expect(entryStatus(60)).toBe("NEUTRAL_ENTRY");
    expect(entryStatus(45)).toBe("WEAK_ENTRY");
    expect(entryStatus(10)).toBe("POOR_ENTRY");
  });
});

describe("valuationMetrics", () => {
  it("matches the uploaded example's fixture output", () => {
    // From example_output.txt: current price such that fair_value_upside=0.18,
    // expected_return=0.30, downside=0.12, risk_reward=2.5.
    const m = valuationMetrics(100, 118, 130, 88);
    expect(m.fairValueUpside).toBeCloseTo(0.18, 6);
    expect(m.marginOfSafety).toBeCloseTo(0.1525, 3);
    expect(m.expectedReturn).toBeCloseTo(0.3, 6);
    expect(m.downside).toBeCloseTo(0.12, 6);
    expect(m.riskReward).toBeCloseTo(2.5, 6);
  });
  it("returns all-null when current price is missing", () => {
    const m = valuationMetrics(null, 100, 110, 90);
    expect(m.fairValueUpside).toBeNull();
    expect(m.expectedReturn).toBeNull();
  });
});

describe("evaluateHorizon", () => {
  it("computes confidence as 100 minus factor-score dispersion, not another weighted average", () => {
    const highConfidence = evaluateHorizon("long", evenScores(70), DEFAULT_WEIGHTS.long, 100, 110);
    expect(highConfidence.confidence).toBeCloseTo(100, 6); // stdev of identical scores is 0

    const scattered = { ...evenScores(70) };
    scattered.quality = 10;
    scattered.risk = 100;
    const lowConfidence = evaluateHorizon("long", scattered, DEFAULT_WEIGHTS.long, 100, 110);
    expect(lowConfidence.confidence).toBeLessThan(highConfidence.confidence);
  });

  it("flags strengths (>=75) and weaknesses (<=40)", () => {
    const scores = evenScores(50);
    scores.quality = 80;
    scores.risk = 30;
    const result = evaluateHorizon("long", scores, DEFAULT_WEIGHTS.long, 100, 110);
    expect(result.strengths).toContain("quality");
    expect(result.weaknesses).toContain("risk");
  });

  it("labels decisions from the default thresholds", () => {
    // All-90 scores -> weighted score is 90 regardless of weight distribution.
    const result = evaluateHorizon("long", evenScores(90), DEFAULT_WEIGHTS.long, 100, 90);
    expect(result.score).toBeCloseTo(90, 3);
    expect(result.decision).toBe("STRONG BUY");
  });
});

describe("overallView", () => {
  it("summarizes across horizons", () => {
    const bullish = {
      short: evaluateHorizon("short", evenScores(85), DEFAULT_WEIGHTS.short, 100, 100),
      medium: evaluateHorizon("medium", evenScores(85), DEFAULT_WEIGHTS.medium, 100, 100),
      long: evaluateHorizon("long", evenScores(85), DEFAULT_WEIGHTS.long, 100, 100),
    };
    expect(overallView(bullish)).toBe("BROADLY BULLISH");
  });
});

describe("buildWarnings", () => {
  it("warns when price is above fair value and when a factor is weak", () => {
    const scores = evenScores(60);
    scores.risk = 30;
    const valuation = valuationMetrics(120, 100, null, null);
    const results = {
      short: evaluateHorizon("short", scores, DEFAULT_WEIGHTS.short, 120, 100),
      medium: evaluateHorizon("medium", scores, DEFAULT_WEIGHTS.medium, 120, 100),
      long: evaluateHorizon("long", scores, DEFAULT_WEIGHTS.long, 120, 100),
    };
    const warnings = buildWarnings(scores, valuation, results);
    expect(warnings.some((w) => /above estimated fair value/.test(w))).toBe(true);
    expect(warnings.some((w) => /Risk score is weak/.test(w))).toBe(true);
  });
});
