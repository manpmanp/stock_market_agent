import { describe, expect, it } from "vitest";
import { CHART_RANGES, isChartRange } from "../src/lib/chart.js";

describe("isChartRange", () => {
  it("accepts exactly the documented range keys", () => {
    for (const r of CHART_RANGES) {
      expect(isChartRange(r)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isChartRange("1y2m")).toBe(false);
    expect(isChartRange("")).toBe(false);
    expect(isChartRange("10y")).toBe(false);
  });
});
