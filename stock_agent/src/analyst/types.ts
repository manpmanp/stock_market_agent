// Output shape for POST /market-analysis's LLM synthesis step (see
// src/analyst/run.ts). Structured, not free text -- the proposal's own
// requirement (docs/agentic-architecture-proposal.md section 3): "a JSON
// schema, not free text, so it's a reusable system output rather than a
// one-off chat answer." The schema itself has no field for a position
// size, allocation, or share count anywhere -- the "never output an
// order instruction" guardrail is enforced structurally, not just by
// prompt instruction, since the model literally has nowhere valid to put
// one.

import type { DecisionHorizon } from "../decision/types.js";

/** One claimed number, traced back to a specific real value this model
 *  was actually given. `ticker` + `metric` together form the lookup key
 *  src/analyst/run.ts's checkGrounding() verifies against the same data
 *  bundle the model was shown -- see buildDataBundle()/flattenNumeric()
 *  there for how `metric`'s dotted-path format is derived. */
export interface AnalystCitation {
  ticker: string;
  metric: string;
  value: number;
}

export type AnalystStance = "enter" | "watch" | "avoid";

export interface AnalystPick {
  ticker: string;
  horizon: DecisionHorizon;
  stance: AnalystStance;
  /** Must reference at least one citation; checkGrounding() rejects a
   *  pick with zero citations as ungrounded (a bare assertion, not a
   *  traceable one). */
  rationale: string;
  citations: AnalystCitation[];
}

export interface AnalystSynthesis {
  /** Cross-ticker read on overall conditions (regime, risk appetite, what
   *  the benchmark/index data implies) that frames the individual picks
   *  below -- still expected to cite benchmark data, not free assertion. */
  marketContext: string;
  citations: AnalystCitation[];
  picks: AnalystPick[];
  /** Anything worth flagging that isn't a pick -- e.g. "no tickers in
   *  config/universe.json currently clear the bar for this horizon." */
  warnings: string[];
}

/** Anthropic tool input_schema for forcing this exact shape via
 *  tool_choice (see callAnalyst() in run.ts). Kept as a plain object
 *  literal, not derived from the TS interface above, since Anthropic's
 *  schema format and TS's structural types aren't the same language --
 *  this is hand-kept in sync with AnalystSynthesis above; a mismatch
 *  would surface immediately as a grounding/shape-validation failure in
 *  run.ts, not a silent bug. */
export const ANALYST_SYNTHESIS_SCHEMA = {
  type: "object",
  properties: {
    marketContext: { type: "string", description: "Cross-ticker read on overall market/benchmark conditions framing the picks below. Must be grounded in the citations array alongside it, not asserted freely." },
    citations: {
      type: "array",
      description: "Citations backing marketContext specifically (e.g. benchmark trend/RSI readings).",
      items: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          metric: { type: "string" },
          value: { type: "number" },
        },
        required: ["ticker", "metric", "value"],
      },
    },
    picks: {
      type: "array",
      description: "Individual ticker calls. Only include tickers actually present in the supplied data -- never invent a ticker.",
      items: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          horizon: { type: "string", enum: ["short", "medium", "long"] },
          stance: { type: "string", enum: ["enter", "watch", "avoid"] },
          rationale: { type: "string", description: "Why, in terms of the cited data -- never a share count, dollar amount, or allocation percentage." },
          citations: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                ticker: { type: "string" },
                metric: { type: "string", description: "Dotted path into the data you were given, e.g. decisions.long.score or supportingMetrics.evToEbit." },
                value: { type: "number", description: "The exact value you were given for that ticker+metric -- never a rounded-off or remembered approximation." },
              },
              required: ["ticker", "metric", "value"],
            },
          },
        },
        required: ["ticker", "horizon", "stance", "rationale", "citations"],
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["marketContext", "citations", "picks", "warnings"],
} as const;
