import { describe, expect, it } from "vitest";
import { overlayLivePrices, type LiveQuote } from "../../src/garp/livePrices.js";
import type { ResearchFile } from "../../src/garp/types.js";

const fld = (value: number | null, asOf = "2026-11-12") => ({ value, asOf, source: "research" });
function file(ticker: string, price: number): ResearchFile {
  return {
    ticker, name: ticker, exchange: "X", currency: "SEK", sector: "", businessSummary: "", retrievedAt: "",
    facts: { price: fld(price), high52w: fld(null), low52w: fld(null) } as unknown as ResearchFile["facts"],
  };
}
const q = (ticker: string, close: number, date = "2026-11-14"): LiveQuote => ({ ticker, close, date, high52w: close * 1.1, low52w: close * 0.8 });

describe("GARP live-price overlay", () => {
  it("applies a newer live close and 52-week range, leaving other tickers as researched", () => {
    const r = overlayLivePrices([file("A.ST", 100), file("B", 50)], [q("A.ST", 104)]);
    expect(r.files[0]!.facts.price.value).toBe(104);
    expect(r.files[0]!.facts.price.asOf).toBe("2026-11-14");
    expect(r.files[0]!.facts.high52w.value).toBeCloseTo(114.4);
    expect(r.files[1]!.facts.price.value).toBe(50);
    expect(r.live).toEqual({ "A.ST": "2026-11-14" });
  });

  it("never mutates the bundled research files", () => {
    const orig = file("A.ST", 100);
    overlayLivePrices([orig], [q("A.ST", 104)]);
    expect(orig.facts.price.value).toBe(100);
  });

  it("ignores a live close older than the researched price", () => {
    const r = overlayLivePrices([file("A.ST", 100)], [q("A.ST", 99, "2026-11-01")]);
    expect(r.files[0]!.facts.price.value).toBe(100);
    expect(r.skipped["A.ST"]).toContain("older");
  });

  it("ignores implausible jumps (unit or currency mismatch, e.g. pence vs pounds)", () => {
    const r = overlayLivePrices([file("REL.L", 3072)], [q("REL.L", 30.7)]);
    expect(r.files[0]!.facts.price.value).toBe(3072);
    expect(r.skipped["REL.L"]).toContain("check units");
  });
});
