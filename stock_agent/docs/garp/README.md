# GARP checker

Defensive GARP research (Masoud's master prompt, `master-prompt.md`) as an internal part of `stock_agent`.

## Isolation contract
- Reads the agent's data (the deployed `/decisions` output: price, multiples, beta, analyst consensus) as one input source.
- Writes only its own paths: `src/garp/`, `scripts/garp*`, `config/garp/`, `test/garp/`, `docs/garp/`, `reports/`.
- Never edits `src/scoring/*`, `src/decision/*`, `src/index.ts`, `src/decisionLab.ts`, `src/dashboard.ts`, migrations or D1 tables. The agent never reads GARP files, so neither can change the other's results.
- Dashboard access: a "GARP Checker" sidebar flyout in `/dashboard` (still the only page address) loads `GET /garp.json` on first open and shows the report in a sandboxed iframe, so its styles never touch the dashboard. `/garp.json` (src/garp/serve.ts) reads only the bundled `config/garp/latest.json`; no D1, no network.
- The only agent files touched are additive hooks: one import + route in `src/index.ts`, and the tab, flyout, CSS and open/close wiring in `src/decisionLab.ts`.

## Files
| Path | Written by | Content |
|---|---|---|
| `config/garp/discovery/*.md` | Discovery agents, lead | Candidate lists with sources; shortlist with reasons |
| `config/garp/research/<TICKER>.json` | Verifier agents (`facts`), lead (`valuation`) | One file per stock |
| `config/garp/conclusion.json` | Lead | Section C picks |
| `config/garp/checks/<date>.md` | Fact-check agent | Discrepancies |
| `config/garp/runs/<date>.json` | Engine | Computed rows |
| `reports/garp-<date>.html` | Engine | Report page |
| `config/garp/latest.json` | Engine | Bundle served by the Worker at `/garp.json` |
| `src/garp/valuation.ts` | Code | Margin of safety, weighted fair value, return, entry zones, value-trap checklist, composite score |
| `src/garp/render.ts` | Code | Report HTML |

## Run
From `stock_agent/`:
```
bash scripts/garp-report.sh
```
Runs the GARP tests, then computes and renders, and writes `config/garp/latest.json`. Local only; no credentials, no D1, no network. To put a new run on the live dashboard, commit and deploy with `bash scripts/deploy.sh` (the Worker bundles `latest.json`).

## Skills
`garp-research` (full run), `garp-verify-stock` (verifier instructions, mirrored in `verify-stock.md`), `garp-refresh` (cheap update).

## Method constants (`src/garp/valuation.ts`)
- Required margin of safety: 20% (quality tier A), 30% (B), 40% (C). Entry price = fair value × (1 − required); accumulation range extends 10 points lower.
- Entry status: BUY ZONE at or below entry; NEAR ENTRY within half the required discount; BELOW FAIR VALUE; ABOVE FAIR VALUE.
- 2–5y return: probability-weighted scenario capital CAGR (EPS growth and exit multiple over 5 years) plus constant dividend yield.
- Value-trap checklist: forward vs trailing multiple (same metric on both sides), revenue trend, operating margin trend, net debt/EBITDA (<2 green, ≤3.5 amber), FCF/EBIT conversion, ROIC vs 8% WACC (ROE vs 10% for banks), verification flags (0-1 green, 2-3 amber, 4+ red), competitive position.
- Score: quality 20%, financial strength 15%, growth 15%, risk 15%, valuation 20%, expected return 15%, minus 5 per red check.

## Published report
Artifact slug `534ba7e6-4201-47aa-9285-1c68dea418d1` (private to Masoud). Refresh runs republish this same artifact.

## Status (2026-11-13, phase 1)
12 Nordic stocks verified and valued. Phase 2 (global candidates, independent fact check) pending. Known gaps: 52-week high/low not retrieved for any stock; historical multiple ranges unverified; AXFO, SWEC, EKTA prices are 19-26 Oct closes.
