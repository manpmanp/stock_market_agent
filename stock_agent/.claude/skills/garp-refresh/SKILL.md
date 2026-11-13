---
name: garp-refresh
description: Cheap update of the GARP checker in stock_agent: refresh prices and consensus, re-verify only stocks with new reports, re-run the engine and republish the report.
---

# GARP refresh

Use when Masoud asks to update, refresh or re-check the GARP checker or its report. For new candidates or a new region use `garp-research`.

## Steps
1. Read every `stock_agent/config/garp/research/*.json` and the latest `config/garp/runs/*.json`. Present a short plan (which tickers need what, which models) and wait for approval before spawning subagents.
2. **Prices and consensus** (lead, no subagent if few tickers; else one Haiku subagent): WebFetch `https://stock-agent.manp-dev.workers.dev/decisions?horizon=long` and update each ticker's `price`, `high52w` if present, `beta5y`, and `consensus` from `supporting_metrics_json`, citing `stock-agent /decisions <run_at>`. Tickers not in the agent's universe: one quick lookup each on stockanalysis.com or MarketScreener.
3. **New reports** (Sonnet subagent per about 4 tickers, only where needed): a ticker needs re-verification if a quarterly or annual report was published after its `retrievedAt`. Use the `garp-verify-stock` instructions. Others keep their facts.
4. **Valuation review** (lead): revisit a stock's `valuation` block only if it was re-verified, its price moved more than 15% since the last run, or a value-trap flag appeared. Otherwise leave assumptions unchanged and note "unchanged since <date>".
5. Run `bash scripts/garp-report.sh` from `stock_agent/`. It writes `config/garp/runs/<date>.json`, `reports/garp-<date>.html` and `config/garp/latest.json` (served at `/garp.json` in the dashboard's GARP Checker flyout after Masoud runs `bash scripts/deploy.sh`).
6. Republish the existing GARP artifact with the new HTML. In the reply list only what changed: entry-status changes, rank changes, new flags.

## Do not
- Change the agent's own code, tables or results (`src/scoring`, `src/decision`, `src/index.ts`, `src/decisionLab.ts`, migrations).
- Re-run discovery; that is a full run.
- Hand-compute margins of safety, upside or IRR; the engine does it.
