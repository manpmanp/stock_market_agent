---
name: garp-verify-stock
description: Verify one or more stocks' fundamentals from primary sources and write the facts block of the GARP checker's per-ticker research JSON in stock_agent. Used by verification subagents.
---

# Verify stock fundamentals for the GARP checker

You verify facts; you do not value or recommend. Write only the files for your assigned tickers: `stock_agent/config/garp/research/<TICKER>.json` (Yahoo ticker convention, e.g. ASSA-B.ST, NOVO-B.CO, ORK.OL). If the file exists, replace only its `facts` block and keep any `valuation` block untouched.

## Sources, in priority order
1. Company interim report (latest quarter) and annual report, investor-relations pages.
2. Shared agent data: WebFetch `https://stock-agent.manp-dev.workers.dev/decisions?horizon=long` and extract only your tickers' `supporting_metrics_json` (price, trailingPe, evToEbitda, netDebtToEbitda, beta, payoutRatio, analyst consensus). Cite it as `stock-agent /decisions <run_at>`. The shell cannot reach websites; use WebFetch/WebSearch.
3. Data providers: stockanalysis.com, MarketScreener, Morningstar, Inderes, Placera/Affärsvärlden. Yahoo Finance pages are blocked for WebFetch; don't retry them.
Budget about 10-15 tool calls per ticker. Don't loop on blocked sites.

## Rules
- Every numeric field: `{"value": number|null, "period": "...", "source": "url or doc", "asOf": "YYYY-MM-DD", "note": "..."}`.
- Unverifiable: value null, note "unavailable". Never estimate silently. Record conflicts between sources in `note`.
- Label periods exactly (TTM, FY2025, FY2025/26, Q3 2026). Watch non-calendar fiscal years.
- Derived ratios (FCF yield, net debt/EBITDA, EV/EBIT) only from verified inputs, with the inputs in `note`. State whether net debt includes IFRS 16 leases.
- Say whether operating profit is EBIT or EBITA, and whether EPS is reported or adjusted.
- Sector-specific: holding companies (NAV per share, discount, loan-to-value); banks (P/B, ROE, CET1, cost/income); set inapplicable fields null with a note.
- Flag value-trap signals honestly: falling organic growth, margin compression, estimate cuts after the latest report, rising leverage, weak cash conversion.

## facts block
```json
{
  "ticker": "", "name": "", "exchange": "", "currency": "", "sector": "", "businessSummary": "",
  "retrievedAt": "ISO timestamp",
  "facts": {
    "price": {}, "high52w": {}, "low52w": {}, "sharesOutstanding": {}, "marketCap": {},
    "netDebt": {}, "enterpriseValue": {},
    "peTrailing": {}, "peForward": {}, "evEbitTrailing": {}, "evEbitForward": {}, "evEbitdaTrailing": {},
    "fcfTTM": {}, "fcfYield": {}, "dividendPerShare": {}, "dividendYield": {}, "payoutRatio": {},
    "netDebtToEbitda": {}, "interestCoverage": {}, "roic": {}, "roe": {}, "beta5y": {},
    "sectorMetrics": {},
    "history": [{"period": "FY2021", "revenue": null, "ebit": null, "ebitMargin": null, "eps": null, "fcf": null, "source": ""}],
    "historicalMultiples": {"peLow": null, "peHigh": null, "peMedian": null, "evEbitMedian": null, "years": "", "source": ""},
    "consensus": {"rating": "", "analysts": null, "buy": null, "hold": null, "sell": null, "targetAvg": null, "targetHigh": null, "targetLow": null, "source": "", "asOf": ""},
    "forwardEstimates": {"epsNextFY": null, "epsFY2": null, "revenueGrowthNextFY": null, "source": ""},
    "recentEvents": [""],
    "valueTrapFlags": [""],
    "dataGaps": [""]
  }
}
```
Monetary amounts in millions of the trading currency except per-share fields; ratios as decimals (0.05 = 5%).

## Return
Under 300 words: one line per ticker (price/date, P/E, EV/EBIT, FCF yield, ND/EBITDA, consensus) plus main gaps and flags, and the file paths written.
