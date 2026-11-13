// On-demand market-analyst endpoint (docs/agentic-architecture-proposal.md
// section 3, build-order step 4): the one narrow, bounded agentic slot in
// this project. Runs strictly AFTER all deterministic scoring (never
// replaces or recomputes it), synthesizes across tickers/benchmarks/
// factors the way a human would eyeball a rankings table, and returns a
// structured (not free-text) read on what's worth entering now and for
// which horizon. Explicitly NOT a portfolio advisor: no holdings, no
// budget, no position sizing or order instructions -- see AnalystSynthesis
// in ./types.ts, which has no field for any of that.
//
// Guardrail mechanics: every claim the model makes must cite a specific
// (ticker, metric) pair whose value it was actually shown (see
// buildDataBundle/flattenNumeric below); checkGrounding() then verifies
// each citation against that same bundle entirely in this Worker's own
// code -- no second LLM call needed to "judge" the first one. A plain
// equality/tolerance check against the exact numbers already in hand is
// strictly more reliable than asking another model to eyeball whether the
// first one hallucinated, and it's free. If a citation doesn't check out,
// the specific violation is fed back and the model gets another attempt,
// up to MAX_ATTEMPTS -- the "factual-grounding loop" from section 4 of the
// proposal, implemented deterministically rather than as analyst+verifier
// LLM calls.

import { getLatestDecisions, getLatestPriceHistory, logSource } from "../lib/db.js";
import type { Env } from "../lib/types.js";
import { loadFullUniverse } from "../ingestion/run.js";
import { loadBenchmarks } from "../ingestion/benchmarks.js";
import { computeIndicators } from "../scoring/indicators.js";
import { HORIZONS, type DecisionHorizon } from "../decision/types.js";
import { ANALYST_SYNTHESIS_SCHEMA, type AnalystCitation, type AnalystSynthesis } from "./types.js";

const MAX_ATTEMPTS = 3;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface TickerBundleEntry {
  decisions: Partial<
    Record<
      DecisionHorizon,
      {
        score: number;
        confidence: number;
        decision: string;
        valuationStatus: string;
        entryStatus: string;
        factorScores: Record<string, number>;
        warnings: string[];
      }
    >
  >;
  supportingMetrics: Record<string, unknown>;
}

export interface BenchmarkBundleEntry {
  name: string;
  regimeProxyFor: string[];
  trendState: string | null;
  rsi14: number | null;
  priceVsSma50: number | null;
  priceVsSma200: number | null;
}

export interface DataBundle {
  asOf: string;
  decisionRunAt: Partial<Record<DecisionHorizon, string>>;
  tickers: Record<string, TickerBundleEntry>;
  benchmarks: Record<string, BenchmarkBundleEntry>;
}

/** Recursively collects every numeric leaf in `obj` into a flat map of
 *  dotted-path -> value. This is deliberately the SAME traversal used to
 *  both (a) know which (ticker, metric) pairs are real, grounded facts
 *  the model was shown, via the lookup this builds, and (b) nothing else
 *  -- the data bundle sent to the model and the lookup checked against it
 *  are derived from one object, so the two can never drift apart. */
export function flattenNumeric(obj: unknown, prefix = "", out: Record<string, number> = {}): Record<string, number> {
  if (obj === null || obj === undefined) return out;
  if (typeof obj === "number" && Number.isFinite(obj)) {
    out[prefix] = obj;
    return out;
  }
  if (Array.isArray(obj) || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    flattenNumeric(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/** Builds the grounding lookup: `${ticker}::${dotted.metric.path}` -> the
 *  real value, from the exact same bundle.tickers/bundle.benchmarks
 *  objects sent to the model. */
export function buildLookup(bundle: DataBundle): Map<string, number> {
  const lookup = new Map<string, number>();
  for (const [ticker, entry] of Object.entries(bundle.tickers)) {
    for (const [path, value] of Object.entries(flattenNumeric(entry))) {
      lookup.set(`${ticker}::${path}`, value);
    }
  }
  for (const [ticker, entry] of Object.entries(bundle.benchmarks)) {
    for (const [path, value] of Object.entries(flattenNumeric(entry))) {
      lookup.set(`${ticker}::${path}`, value);
    }
  }
  return lookup;
}

/** Pulls together every tracked ticker's latest decision-engine output
 *  (all three horizons) plus a simple trend/momentum read on each
 *  configured benchmark -- the only two inputs this endpoint is allowed
 *  to reason from (see the proposal's "Inputs" list in section 3; no
 *  holdings, no budget). Benchmarks are read from their own price_history
 *  rows (already ingested with active=0, see src/ingestion/benchmarks.ts)
 *  rather than fetched fresh, so this stays a read-only, side-effect-free
 *  endpoint. */
async function buildDataBundle(env: Env): Promise<DataBundle> {
  const decisionRunAt: Partial<Record<DecisionHorizon, string>> = {};
  const tickers: Record<string, TickerBundleEntry> = {};

  for (const horizon of HORIZONS) {
    const rows = await getLatestDecisions(env, horizon, 500);
    for (const row of rows as Array<Record<string, unknown>>) {
      const ticker = row.ticker as string;
      const runAt = row.run_at as string;
      decisionRunAt[horizon] = runAt;
      const entry = tickers[ticker] ?? { decisions: {}, supportingMetrics: {} };
      let factorScores: Record<string, number> = {};
      let warnings: string[] = [];
      let supportingMetrics: Record<string, unknown> = {};
      try {
        factorScores = JSON.parse(row.factor_scores_json as string);
      } catch {
        /* leave empty -- a parse failure here just means this horizon's
           factor breakdown is unavailable, not a reason to fail the whole
           bundle */
      }
      try {
        warnings = JSON.parse(row.warnings_json as string);
      } catch {
        /* same as above */
      }
      try {
        supportingMetrics = JSON.parse(row.supporting_metrics_json as string);
      } catch {
        /* same as above */
      }
      entry.decisions[horizon] = {
        score: row.score as number,
        confidence: row.confidence as number,
        decision: row.decision as string,
        valuationStatus: row.valuation_status as string,
        entryStatus: row.entry_status as string,
        factorScores,
        warnings,
      };
      // supportingMetrics is identical across horizons for the same
      // ticker/run (it isn't horizon-specific) -- keep whichever was seen
      // first, overwrite is harmless either way.
      if (Object.keys(entry.supportingMetrics).length === 0) entry.supportingMetrics = supportingMetrics;
      tickers[ticker] = entry;
    }
  }

  const universeTickers = new Set((await loadFullUniverse(env)).map((u) => u.ticker));
  // Defensive: only keep tickers that are both currently tracked AND have
  // decision rows -- a ticker demoted from the universe after its last
  // decision run shouldn't still be offered as a live pick.
  for (const ticker of Object.keys(tickers)) {
    if (!universeTickers.has(ticker)) delete tickers[ticker];
  }

  const benchmarks: Record<string, BenchmarkBundleEntry> = {};
  for (const b of loadBenchmarks()) {
    const bars = await getLatestPriceHistory(env, b.ticker, 260);
    if (bars.length < 30) continue; // too little history for a meaningful read -- omit rather than guess
    const indicators = computeIndicators(bars.map((bar) => ({ date: bar.date, close: bar.close, volume: bar.volume })));
    benchmarks[b.ticker] = {
      name: b.name,
      regimeProxyFor: b.regime_proxy_for,
      trendState: indicators.trendState,
      rsi14: indicators.rsi14,
      priceVsSma50: indicators.priceVsSma50,
      priceVsSma200: indicators.priceVsSma200,
    };
  }

  return { asOf: new Date().toISOString(), decisionRunAt, tickers, benchmarks };
}

const SYSTEM_PROMPT = `You are a market analyst reviewing an already-computed, deterministic stock-scoring system. You are NOT a portfolio advisor: you have no view of the user's holdings, budget, or risk tolerance, and you must never suggest a position size, share count, dollar allocation, or order instruction of any kind -- that is strictly out of scope and will be rejected.

You will be given, as JSON: every currently tracked ticker's decision-engine output across three horizons (short, medium, long) -- a 0-100 score, a decision label, a confidence, per-factor 0-100 scores (quality, growth, financial_strength, valuation, future_potential, technical, entry, risk, catalyst, market_regime), and supporting valuation/leverage metrics; plus a simple trend/momentum read on each benchmark index, each tagged with which ticker region(s) it proxies for.

Your job: synthesize across tickers, factors, and the relevant benchmark context to identify which tickers look worth entering right now, for which horizon, and explain why -- cross-checking each pick's own factor scores against how its benchmark is behaving, not in isolation. You may also flag tickers worth avoiding or just watching.

Hard rule: every single factual claim you make -- in marketContext and in every pick's rationale -- must be backed by at least one citation in that section's citations array, and every citation's (ticker, metric, value) must be copied EXACTLY from the data you were given, not rounded, not remembered, not inferred. Never invent a ticker, metric, or value that isn't in the data. Never override or second-guess a factor score -- your job is to synthesize and explain the existing scores, not replace them with your own judgment of what they should be. If the data doesn't support a confident read, say so in warnings rather than forcing a pick.

Respond with JSON matching the schema you were given -- nothing else, no surrounding prose.`;

interface AnthropicCallResult {
  ok: boolean;
  synthesis: AnalystSynthesis | null;
  error?: string;
}

/**
 * Bring-your-own-key: a visitor may supply their own Anthropic API key for one
 * /market-analysis run. It is used for this call only -- never stored, never
 * logged, never written to D1 -- and it replaces the owner's key, so the
 * visitor's own Anthropic account is billed.
 */
export interface AnalystKeyOptions {
  apiKey?: string;
}

/** Remove a key from any text before it can reach a response or log. */
export function redactKey(text: string, key: string | undefined): string {
  if (!key) return text;
  return text.split(key).join("[redacted-key]");
}

async function callAnalyst(env: Env, userContent: string, opts: AnalystKeyOptions = {}): Promise<AnthropicCallResult> {
  const apiKey = opts.apiKey ?? env.ANTHROPIC_API_KEY;
  if (!apiKey || !env.ANTHROPIC_MODEL) {
    return { ok: false, synthesis: null, error: opts.apiKey ? "ANTHROPIC_MODEL not configured on this Worker" : "ANTHROPIC_API_KEY and/or ANTHROPIC_MODEL not configured (set both with `wrangler secret put`)" };
  }
  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL,
        // Generous headroom over the proposal's ~3,000-token output
        // estimate (docs/agentic-architecture-proposal.md section 5) --
        // with no tool-call wrapper overhead now (see output_config
        // below), a wide universe with many citations per pick could
        // still run long, and a truncated response is an explicit error
        // (stop_reason === "max_tokens" below) rather than a silent
        // partial parse.
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        // Originally this forced a specific tool call via tool_choice:
        // {type: "tool", name: ...} -- that 400'd the first time this
        // endpoint was actually called ("tool_choice: type \"tool\" and
        // \"any\" are not supported for this model", confirmed against
        // Anthropic's own docs as an unconditional restriction on Sonnet
        // 5.5/Opus 5.5). output_config.format is the current mechanism
        // for forcing one exact JSON shape and needs no tools/tool_choice
        // at all -- see ANALYST_SYNTHESIS_SCHEMA's own comment in
        // ./types.ts for why its objects all carry additionalProperties:
        // false (required by this mode).
        output_config: {
          format: { type: "json_schema", schema: ANALYST_SYNTHESIS_SCHEMA },
        },
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, synthesis: null, error: redactKey(`Anthropic API HTTP ${resp.status}: ${text.slice(0, 500)}`, apiKey) };
    }
    const body = (await resp.json()) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };
    if (body.stop_reason === "refusal") {
      return { ok: false, synthesis: null, error: "Anthropic declined to produce a response for this request (stop_reason: refusal)" };
    }
    if (body.stop_reason === "max_tokens") {
      return { ok: false, synthesis: null, error: "Anthropic response was cut off at the max_tokens limit before completing -- raise max_tokens in callAnalyst()" };
    }
    const textBlock = (body.content ?? []).find((c) => c.type === "text" && typeof c.text === "string");
    if (!textBlock || !textBlock.text) {
      return { ok: false, synthesis: null, error: "Anthropic response did not include the expected text content block" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch (err) {
      return { ok: false, synthesis: null, error: `Anthropic response text was not valid JSON: ${(err as Error).message}` };
    }
    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, synthesis: null, error: "Anthropic response JSON was not an object" };
    }
    return { ok: true, synthesis: parsed as AnalystSynthesis };
  } catch (err) {
    return { ok: false, synthesis: null, error: redactKey(`Anthropic API call threw: ${(err as Error).message}`, apiKey) };
  }
}

/** Shape-validates `synthesis` beyond what the API's own schema
 *  enforcement guarantees (defensive -- a model can still return
 *  something subtly malformed despite output_config.format forcing the
 *  shape) and
 *  verifies every citation's claimed value against `lookup`, the exact
 *  data the model was shown. Returns a flat list of violations, each one
 *  specific enough to feed back to the model verbatim; empty means fully
 *  grounded. */
export function checkGrounding(synthesis: AnalystSynthesis, lookup: Map<string, number>, bundle: DataBundle): string[] {
  const violations: string[] = [];

  function checkCitations(citations: AnalystCitation[] | undefined, context: string): void {
    if (!Array.isArray(citations) || citations.length === 0) {
      violations.push(`${context} has no citations -- every claim must cite at least one real (ticker, metric, value).`);
      return;
    }
    for (const c of citations) {
      if (!c || typeof c.ticker !== "string" || typeof c.metric !== "string" || typeof c.value !== "number") {
        violations.push(`${context} has a malformed citation (missing ticker/metric/value).`);
        continue;
      }
      const key = `${c.ticker}::${c.metric}`;
      const actual = lookup.get(key);
      if (actual === undefined) {
        violations.push(`${context} cites ${c.ticker} metric "${c.metric}", which does not exist in the data you were given.`);
        continue;
      }
      const tolerance = Math.max(0.6, Math.abs(actual) * 0.02);
      if (Math.abs(actual - c.value) > tolerance) {
        violations.push(`${context} claims ${c.ticker} "${c.metric}" = ${c.value}, but the real value is ${actual}.`);
      }
    }
  }

  if (!synthesis || typeof synthesis !== "object") {
    return ["Response was not a valid object matching the expected schema."];
  }
  checkCitations(synthesis.citations, "marketContext");
  if (!Array.isArray(synthesis.picks)) {
    violations.push("picks is missing or not an array.");
  } else {
    for (const pick of synthesis.picks) {
      if (!pick || typeof pick.ticker !== "string") {
        violations.push("A pick is missing a ticker.");
        continue;
      }
      const tickerEntry = bundle.tickers[pick.ticker];
      if (!tickerEntry) {
        violations.push(`Pick "${pick.ticker}" is not in the tracked universe you were given data for.`);
      } else if (!HORIZONS.includes(pick.horizon) || !tickerEntry.decisions[pick.horizon]) {
        violations.push(`Pick "${pick.ticker}" cites horizon "${pick.horizon}", which has no decision data for that ticker.`);
      }
      checkCitations(pick.citations, `Pick "${pick.ticker}"`);
    }
  }
  return violations;
}

export interface MarketAnalysisResult {
  ok: boolean;
  asOf: string;
  decisionRunAt: Partial<Record<DecisionHorizon, string>>;
  tickersConsidered: number;
  benchmarksConsidered: number;
  synthesis: AnalystSynthesis | null;
  attempts: number;
  fullyGrounded: boolean;
  groundingWarnings: string[];
  error?: string;
}

export async function runMarketAnalysis(env: Env, opts: AnalystKeyOptions = {}): Promise<MarketAnalysisResult> {
  const bundle = await buildDataBundle(env);
  const tickersConsidered = Object.keys(bundle.tickers).length;
  const benchmarksConsidered = Object.keys(bundle.benchmarks).length;

  if (tickersConsidered === 0) {
    return {
      ok: false,
      asOf: bundle.asOf,
      decisionRunAt: bundle.decisionRunAt,
      tickersConsidered,
      benchmarksConsidered,
      synthesis: null,
      attempts: 0,
      fullyGrounded: false,
      groundingWarnings: [],
      error: "No decision data available -- run POST /decide (or wait for the next scheduled run) before calling /market-analysis.",
    };
  }

  const lookup = buildLookup(bundle);
  const dataJson = JSON.stringify({ asOf: bundle.asOf, decisionRunAt: bundle.decisionRunAt, tickers: bundle.tickers, benchmarks: bundle.benchmarks });

  let violations: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const userContent =
      violations.length === 0
        ? `Here is the current data:\n\n${dataJson}`
        : `Here is the current data:\n\n${dataJson}\n\nYour previous attempt had these grounding violations -- each one means a cited (ticker, metric, value) didn't match the real data above, or a required field was missing. Fix every one of them and re-emit a corrected, fully-grounded call:\n${violations.map((v) => `- ${v}`).join("\n")}`;

    const result = await callAnalyst(env, userContent, opts);
    if (!result.ok || !result.synthesis) {
      await logSource(env, { source: opts.apiKey ? "anthropic_market_analysis_visitor_key" : "anthropic_market_analysis", status: "error", error: result.error ?? "unknown error" });
      return {
        ok: false,
        asOf: bundle.asOf,
        decisionRunAt: bundle.decisionRunAt,
        tickersConsidered,
        benchmarksConsidered,
        synthesis: null,
        attempts: attempt,
        fullyGrounded: false,
        groundingWarnings: [],
        error: result.error,
      };
    }

    violations = checkGrounding(result.synthesis, lookup, bundle);
    if (violations.length === 0) {
      await logSource(env, { source: opts.apiKey ? "anthropic_market_analysis_visitor_key" : "anthropic_market_analysis", status: "ok" });
      return {
        ok: true,
        asOf: bundle.asOf,
        decisionRunAt: bundle.decisionRunAt,
        tickersConsidered,
        benchmarksConsidered,
        synthesis: result.synthesis,
        attempts: attempt,
        fullyGrounded: true,
        groundingWarnings: [],
      };
    }
    if (attempt === MAX_ATTEMPTS) {
      await logSource(env, { source: opts.apiKey ? "anthropic_market_analysis_visitor_key" : "anthropic_market_analysis", status: "ok", error: `returned after ${attempt} attempts with unresolved grounding violations` });
      return {
        ok: true,
        asOf: bundle.asOf,
        decisionRunAt: bundle.decisionRunAt,
        tickersConsidered,
        benchmarksConsidered,
        synthesis: result.synthesis,
        attempts: attempt,
        fullyGrounded: false,
        groundingWarnings: violations,
      };
    }
  }

  // Unreachable (the loop above always returns by MAX_ATTEMPTS), but kept
  // for exhaustiveness so this function's return type doesn't need a
  // non-null assertion at the call site.
  throw new Error("runMarketAnalysis: exhausted attempts without returning");
}
