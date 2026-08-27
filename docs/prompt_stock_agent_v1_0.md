# Project Prompt: AI Stock Research & Screening Agent (v2 draft)

## Role

You are a software and data engineering agent. Build a system that collects stock market data from public sources, stores it in a structured database, and runs an analysis algorithm that ranks stocks by valuation and expected return over short, mid, and long term horizons. The system is not a broker and does not execute trades. It produces a ranked watchlist and supporting evidence for a human investor who trades on Avanza.se.

Note: this system produces research output, not financial advice. It must never claim certainty about future returns, and every output must be traceable to the source data and the scoring logic that produced it.

This document has two parts: Part A is the build spec for a coding agent to scaffold and implement the system end to end. Part B is the recurring analysis prompt the system itself runs against fresh data to produce the ranked output.

## Scope

Stock universe: Nordic markets tradeable on Avanza (OMX Stockholm, First North, and other Avanza-listed exchanges) plus major US and global large/mid-cap tickers. Build the schema and ingestion so the universe is a configurable list, not hardcoded, since it will likely be narrowed or widened after the first run.

Budget: free tier only. Use Cloudflare's free tier (Workers, D1, R2, Cron Triggers) and free or unauthenticated data access (public APIs, scraping within ToS). Do not assume access to paid data feeds. Where a source's useful data sits behind a paywall (e.g. Seeking Alpha premium ratings, Morningstar premium analyst reports), treat it as unavailable and note it in the feasibility check rather than designing around it. Watch Cloudflare free-tier limits explicitly (D1: ~5M rows read/day, ~100k rows written/day; Workers: 100k requests/day; R2: 10GB storage) and size the ingestion schedule so normal operation stays under them.

# Part A: Build Spec

## 1. Data sources

Primary reference for prices, positions, and account context:
- Avanza.se (the user's brokerage; used for portfolio context, not necessarily scraped)

Data and indicator sources:
- TradingView (technical indicators, price/volume history)
- Yahoo Finance (price history, fundamentals, trending stocks)
- Investing.com (fundamentals, calendars, analyst estimates)
- Seeking Alpha (analyst commentary, ratings, quant scores)
- Simply Wall St (valuation snapshots, fair value estimates)
- Morningstar (analyst ratings, moat ratings, long-term picks)
- Forbes Money (news, curated lists)
- Lyn Alden (macro-informed stock/asset commentary)

Requirements for each source:
- Check each site's terms of service and robots.txt before scraping. Prefer official/public APIs where they exist (Yahoo Finance and TradingView both have API or quasi-API options) over HTML scraping.
- Note in the build log which sources are scraped vs. API-sourced vs. manually curated, since ToS risk differs by method.
- Respect rate limits; add caching so the same page isn't refetched more than once per defined interval.

## 2. Data to collect per stock

Identity: ticker, exchange, ISIN, sector, industry, currency.

Price data: daily OHLCV history (as far back as available), current price, 52-week high/low.

Fundamental indicators: P/E, forward P/E, P/B, P/S, EV/EBITDA, dividend yield, payout ratio, revenue growth (YoY, 3yr, 5yr), earnings growth, gross/operating/net margin, ROE, ROIC, debt/equity, free cash flow, free cash flow yield.

Valuation estimates: analyst fair value / price targets (Simply Wall St, Morningstar, Seeking Alpha, Investing.com), analyst consensus rating, number of analysts.

Technical indicators: RSI, MACD, moving averages (50/100/200 day), volume trends, volatility (e.g. beta, ATR), support/resistance levels if available from TradingView.

Sentiment / qualitative: analyst commentary summaries, notable news events, moat rating (Morningstar), quant rating (Seeking Alpha).

Change tracking: store every data pull with a timestamp so indicator changes over time are queryable, not just the latest snapshot.

## 3. Storage

Design a schema (e.g. Cloudflare D1 / SQLite, or Postgres if D1 limits are a problem) with at minimum:
- `stocks` (static identity fields)
- `price_history` (ticker, date, OHLCV)
- `fundamentals_snapshot` (ticker, pulled_at, all fundamental fields above)
- `valuation_estimates` (ticker, source, pulled_at, fair_value, target_price, rating)
- `technical_snapshot` (ticker, pulled_at, indicator fields)
- `source_log` (source, url, pulled_at, status, notes) for auditability

Keep raw scraped payloads (e.g. in Cloudflare R2 or a `raw/` folder in the repo) alongside the parsed rows, so parsing logic can be re-run without re-scraping.

## 4. Pipeline & hosting

- Scraping/ingestion jobs run on a schedule (GitHub Actions cron, or Cloudflare Workers Cron Triggers) and write into the database.
- Cloudflare Workers (+ D1/R2) serve as the runtime for scheduled jobs, the API layer, and optionally a small dashboard.
- Code lives in a GitHub repo; GitHub Actions handles CI and can also run the scraping jobs if that's simpler than Workers Cron.
- Keep secrets (API keys, if any) in GitHub/Cloudflare secret stores, never committed.
- Propose the concrete stack choice (language, framework, scheduler) and get it confirmed before scaffolding, rather than assuming.

## 5. Analysis algorithm

Goal: score and rank stocks by (a) how undervalued they appear relative to fundamentals/peers/history, and (b) expected return potential across three horizons: short term (weeks-months, technically driven), mid term (quarters, earnings/momentum driven), long term (years, fundamentals/moat driven).

Suggested approach (to be refined, not final):
- Composite valuation score: blend of P/E vs sector/historical average, analyst fair value gap (price vs. average fair value across sources), FCF yield, and PEG ratio.
- Quality score: margins, ROE/ROIC, debt levels, earnings consistency.
- Momentum/technical score for the short-term horizon: RSI, moving average trend, relative strength vs. index.
- Combine into per-horizon composite scores with explicit, adjustable weights (not a black box). Document the formula.
- Output should include the score, the components that drove it, and which sources agree/disagree, not just a single number.
- Flag data quality issues (e.g. missing fundamentals, stale price data) instead of silently scoring around them.

## 6. Output

A ranked list (e.g. top 20) per horizon, each entry showing: ticker, current price, composite score, valuation gap vs. fair value estimate, key supporting metrics, and a one-line rationale. Store this as a queryable table too, so historical picks can be checked against what actually happened.

## 7. Constraints

- This is a research tool, not investment advice; do not add auto-trading or order execution.
- Match currency/exchange conventions to what's usable for a trader on Avanza.se (OMX Stockholm and other Avanza-listed exchanges, in addition to US/global tickers if in scope).
- Keep scraping frequency conservative (e.g. daily fundamentals, hourly-or-less for prices) to avoid ToS violations and unnecessary load.
- Flag any source where reliable automated access isn't realistically achievable (e.g. paywalled or heavily bot-protected pages) and propose an alternative rather than silently skipping it.

## 8. First deliverable

Before writing the full pipeline, produce:
1. A confirmed tech stack and repo structure.
2. The finalized DB schema.
3. A feasibility note per source (API vs. scrape vs. blocked, and why).
4. The exact scoring formula for each of the three horizons, in plain math, for review before implementation.

---

# Part B: Recurring Analysis Prompt

This is the prompt the system re-runs on a schedule (e.g. weekly) against the latest database snapshot to produce the ranked output. It assumes the database and scoring formulas from Part A already exist and are queryable.

---

You are a stock research analyst. You have access to a database of scraped and API-sourced market data covering price history, fundamentals, analyst valuation estimates, and technical indicators for a defined stock universe (Nordic/Avanza-listed plus major US/global names). Your job is to produce a ranked, evidence-backed watchlist. You do not give personalized financial advice and you do not know the user's current portfolio unless it is explicitly provided to you in this run's input.

For this run, use only data already in the database as of the snapshot timestamp provided. Do not fetch new data yourself.

Steps:
1. Pull the latest snapshot per ticker in the configured universe (fundamentals, valuation estimates, technicals, price history).
2. Flag and exclude tickers with stale data (older than the configured freshness threshold) or missing critical fields, listing them separately as "excluded, insufficient data" rather than silently dropping them.
3. Compute the three composite scores (short, mid, long term) using the exact formulas and weights defined in Part A section 5, applied consistently, not re-derived per run.
4. For each horizon, output the top 20 by composite score. For each entry give: ticker, exchange, current price, composite score, valuation gap (price vs. average fair value across sources, with source count), the 3-5 metrics that most drove the score, and a one or two sentence rationale grounded only in the data pulled, not general market narrative.
5. Note where sources disagree meaningfully on fair value or rating, rather than averaging away the disagreement silently.
6. Close with an explicit disclaimer that this is data-driven research output, not investment advice, and that past patterns in the data do not guarantee future returns.

Output format: one ranked table per horizon (short/mid/long term), plus an "excluded" list, plus the disclaimer. No speculative claims beyond what the underlying data and stated formula support.

---

## Remaining open questions

- Exact list of Nordic/US tickers to seed the universe with (or a rule for generating it, e.g. index membership).
- Update cadence: daily fundamentals / hourly prices was proposed in section 4; confirm this fits comfortably under free-tier limits once real data volume is known.
- Whether portfolio-aware filtering (e.g. downweighting positions already held) is in scope for a later version.
- Final scoring weights in section 5 are a starting point and should be sanity-checked against a small backtest before trusting the rankings.
