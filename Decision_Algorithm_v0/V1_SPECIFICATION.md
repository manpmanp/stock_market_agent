# Stock Decision Algorithm V1 — Specification

## Input

A stock is represented by ten normalized factor scores, each from 0 to 100.

| Factor | Meaning |
|---|---|
| Quality | Business quality, profitability, economics, competitive characteristics |
| Growth | Historical and expected growth |
| Financial Strength | Balance sheet, cash generation and financial resilience |
| Valuation | Relative/intrinsic valuation attractiveness |
| Future Potential | TAM, reinvestment runway, structural growth and earnings potential |
| Technical | Trend, momentum, relative strength and market structure |
| Entry | Quality of the current purchase point |
| Risk | Downside, volatility, leverage and business/investment risks |
| Catalyst | Events that could change expectations or valuation |
| Market Regime | Broader market/sector conditions |

## Output

For each horizon:

- weighted score: 0–100
- decision
- confidence indicator
- factor contributions
- strongest factors
- weakest factors
- valuation status
- entry status

Additionally:

- overall view
- fair-value upside
- margin of safety
- expected return
- downside
- risk/reward
- warnings

## Decisions

| Score | Decision |
|---:|---|
| >= 85 | STRONG BUY |
| 75–84.99 | BUY |
| 65–74.99 | ACCUMULATE |
| 50–64.99 | HOLD / WAIT |
| 40–49.99 | REDUCE |
| 25–39.99 | SELL |
| < 25 | STRONG SELL |

These thresholds are also provisional and should eventually be investigated.

## Architecture

Raw data is intentionally outside this first version.

The intended future pipeline is:

Raw data
→ factor calculations
→ normalized factor scores
→ this decision engine
→ decision/explanation

This keeps the decision algorithm independent from any particular data provider.

## Explicitly excluded from V1

- data collection
- broker integration
- portfolio management
- automated trading
- news scraping
- LLM agent
- database
- dashboards
- scheduled alerts
- live market feeds
- production backtesting

Those belong to later system layers, not the first algorithm version.
