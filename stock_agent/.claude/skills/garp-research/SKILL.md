---
name: garp-research
description: Run Masoud's full defensive GARP stock research (master prompt) for the GARP checker inside stock_agent: discovery, verification, valuation, ranking and report, with model routing per step.
---

# GARP research: full run

Use when Masoud asks for a full GARP / defensive-GARP research run, a new region, or new candidates for the GARP checker. For a routine update of existing names use `garp-refresh` instead.

## Ground rules
- The full research standard is Masoud's master prompt, kept in the repo at `stock_agent/docs/garp/master-prompt.md`. Read it before starting. Its data-integrity rules (section 11) are mandatory: sources and dates for every material figure, null plus "unavailable" instead of guesses, independent fair values (never copied analyst targets).
- Before spawning any subagent, present the plan (how the work is split, where outputs go, how agents interact) and wait for Masoud's approval.
- The GARP checker lives inside `stock_agent` but must never write to or change the agent's own code paths or results: `src/scoring/*`, `src/decision/*`, `src/index.ts`, `src/decisionLab.ts`, D1 migrations and tables. It may READ the agent's data.
- Masoud is on the Pro plan: split large runs into phases that each fit one session (about 12 stocks per phase).

## Repo layout (all paths under `stock_agent/`)
| Path | Owner | Content |
|---|---|---|
| `docs/garp/master-prompt.md` | Masoud | Research standard |
| `docs/garp/verify-stock.md` | GARP | Verifier instructions (same as skill `garp-verify-stock`) |
| `config/garp/discovery/<date>-<region>.md` | Discovery agents | Candidate lists with sources |
| `config/garp/research/<TICKER>.json` | Verifier writes `facts`; lead writes `valuation` | One file per stock |
| `config/garp/checks/<date>.md` | Fact-checker | Discrepancies found |
| `config/garp/runs/<date>.json` | Engine | Computed output of a run |
| `src/garp/*.ts` | GARP | Deterministic engine and renderer |
| `test/garp/*.test.ts` | GARP | Vitest tests |

## Shared data from the agent (read only)
The deployed Worker exposes `https://stock-agent.manp-dev.workers.dev/decisions?horizon=long`. Each row's `supporting_metrics_json` has currentPrice, trailingPe, evToEbitda, priceToBook, netDebtToEbitda, beta, payoutRatio and analyst consensus (count, rating, target low/mean/high). The shell proxy blocks this host; use WebFetch with a prompt that extracts only the needed tickers (the page is about 500k characters). Record these as source `stock-agent /decisions <run_at>`.

## Steps and model routing
1. **Discovery** (Haiku subagents, 2 in parallel, background): Swedish/Nordic lists (Börskollen, Nordnet, EFN, SEB, DI, Avanza) and international screeners/broker notes. Output candidate tables with source and date per mention, plus exclusion signals (downgrades, profit warnings). Save to `config/garp/discovery/`.
2. **Shortlist** (lead model, no subagent): apply section 9 exclusion rules and defensive fit; pick about 12. Record the reason for each inclusion and each notable exclusion.
3. **Verification** (Sonnet subagents, about 4 tickers each, in parallel, background): give each the `garp-verify-stock` instructions, its tickers, and the shared-data note above. Each writes only its own `research/<TICKER>.json` files (`facts` block) and returns a short summary. Agents never edit each other's files.
4. **Valuation** (lead model): for each stock, write the `valuation` block (method, normalized earnings, bear/base/bull fair values with probabilities summing to 1, 5-year EPS growth and exit multiple per scenario, quality tier, portfolio role, principal risk, rationale). Then run the engine: `bash scripts/garp-report.sh` from `stock_agent/`. Never hand-compute margin of safety, upside, IRR or ranks; the engine does that.
5. **Fact check** (one fresh Sonnet subagent that did not do the verification): re-verify price, one multiple and one history figure per stock against original sources; write `config/garp/checks/<date>.md`. Lead resolves mismatches in the JSON and re-runs the engine.
6. **Report**: the engine writes `config/garp/runs/<date>.json` and `reports/garp-<date>.html`. Publish the HTML as an artifact (republish the same artifact on later runs). Max about two scrolls; green/amber/red indicators; verified facts, analyst opinion and independent estimates visually distinct.
7. **Conclusion**: top three, best defensive, best risk-adjusted growth, most undervalued, best 2-5y, best 5-10y, watch-but-not-buy. Leave a category empty if evidence is insufficient.

## Delivery
Commit only new files under the paths above. Do not touch existing agent files. If wiring into `/dashboard` is requested, it is two additive changes (a sidebar bookmark and a read-only JSON endpoint) and needs Masoud's explicit go; `/dashboard` stays the only page address.
