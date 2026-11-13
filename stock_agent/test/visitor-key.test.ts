import { beforeEach, describe, expect, it } from "vitest";
import { readVisitorKey, resetVisitorLimits, visitorAllowed, VISITOR_LIMIT, VISITOR_WINDOW_MS } from "../src/analyst/visitorKey.js";
import { redactKey } from "../src/analyst/run.js";

const KEY = "sk-ant-api03-" + "a".repeat(40);
const req = (headers: Record<string, string>) => new Request("https://x/market-analysis", { method: "POST", headers });

describe("visitor Anthropic key (bring your own key)", () => {
  beforeEach(() => resetVisitorLimits());

  it("accepts a well-formed key from x-anthropic-key", () => {
    expect(readVisitorKey(req({ "x-anthropic-key": KEY }))).toBe(KEY);
  });

  it("rejects missing, malformed or non-Anthropic keys", () => {
    expect(readVisitorKey(req({}))).toBeNull();
    expect(readVisitorKey(req({ "x-anthropic-key": "sk-ant-short" }))).toBeNull();
    expect(readVisitorKey(req({ "x-anthropic-key": "Bearer something" }))).toBeNull();
    expect(readVisitorKey(req({ "x-anthropic-key": "sk-ant-" + "a".repeat(30) + " rm -rf" }))).toBeNull();
  });

  it("an admin bearer token is not treated as a visitor key", () => {
    expect(readVisitorKey(req({ authorization: "Bearer " + KEY }))).toBeNull();
  });

  it("rate-limits each visitor to VISITOR_LIMIT runs per window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < VISITOR_LIMIT; i++) expect(visitorAllowed("1.2.3.4", t0 + i)).toBe(true);
    expect(visitorAllowed("1.2.3.4", t0 + 10)).toBe(false);
    expect(visitorAllowed("5.6.7.8", t0 + 10)).toBe(true);
    expect(visitorAllowed("1.2.3.4", t0 + VISITOR_WINDOW_MS + 1)).toBe(true);
  });

  it("redacts the key from any error text", () => {
    expect(redactKey(`HTTP 401: invalid x-api-key ${KEY}`, KEY)).toBe("HTTP 401: invalid x-api-key [redacted-key]");
    expect(redactKey("no key here", undefined)).toBe("no key here");
  });
});
