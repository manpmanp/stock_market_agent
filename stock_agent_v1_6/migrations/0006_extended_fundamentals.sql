-- Additional raw fundamentals + analyst-recommendation data, requested to
-- support cross-checks the decision engine (src/decision/*) didn't have
-- yet -- EV/EBIT vs. P/E in particular, plus Net Debt/EBITDA, interest
-- coverage, Beta, and Return on Assets. All plain nullable additive
-- columns (ALTER TABLE ADD COLUMN), so unlike migration 0004 this needs no
-- table rebuild -- existing rows just get NULL for these until the next
-- ingestion run fills them in.
--
-- Two of these (ebit, interest_expense) come from a Yahoo Finance module
-- (incomeStatementHistory) this project didn't previously fetch -- see
-- lib/yahoo.ts fetchQuoteSummary. The rest (beta, enterprise_value,
-- return_on_assets, ebitda, total_debt, total_cash) come from modules
-- already being fetched (defaultKeyStatistics, financialData), just
-- fields that weren't being read yet.
--
-- EV/EBIT, Net Debt/EBITDA, and interest coverage are deliberately NOT
-- stored as precomputed ratios -- they're derived from these raw columns
-- at read time (src/decision/factors.ts), same convention as the existing
-- valuation-gap-vs-fair-value calculation.
ALTER TABLE fundamentals_snapshot ADD COLUMN beta REAL;
ALTER TABLE fundamentals_snapshot ADD COLUMN return_on_assets REAL;
ALTER TABLE fundamentals_snapshot ADD COLUMN ebit REAL;              -- operating income, most recent annual
ALTER TABLE fundamentals_snapshot ADD COLUMN ebitda REAL;
ALTER TABLE fundamentals_snapshot ADD COLUMN enterprise_value REAL;
ALTER TABLE fundamentals_snapshot ADD COLUMN total_debt REAL;
ALTER TABLE fundamentals_snapshot ADD COLUMN total_cash REAL;
ALTER TABLE fundamentals_snapshot ADD COLUMN interest_expense REAL; -- most recent annual, positive magnitude

-- Analyst recommendation-trend breakdown (current month), from Yahoo's
-- recommendationTrend module (already fetched for recommendationKey, just
-- not this breakdown until now). Shown as a cross-check on decision cards,
-- never blended into the weighted factor score -- same "shown separately"
-- treatment as valuation_status/entry_status already get.
ALTER TABLE valuation_estimates ADD COLUMN rec_strong_buy INTEGER;
ALTER TABLE valuation_estimates ADD COLUMN rec_buy INTEGER;
ALTER TABLE valuation_estimates ADD COLUMN rec_hold INTEGER;
ALTER TABLE valuation_estimates ADD COLUMN rec_sell INTEGER;
ALTER TABLE valuation_estimates ADD COLUMN rec_strong_sell INTEGER;

-- Per-ticker supporting-metrics snapshot (EV/EBIT, Net Debt/EBITDA,
-- interest coverage, Beta, ROA, and the analyst recommendation/target
-- spread) as they stood at decision-run time, so /decision-lab can show
-- the underlying numbers behind the score without re-querying
-- fundamentals_snapshot/valuation_estimates separately. Same value is
-- written on all 3 horizon rows for one ticker in one run (these aren't
-- horizon-specific), matching how valuation_status/entry_status are
-- already duplicated per horizon.
ALTER TABLE decisions ADD COLUMN supporting_metrics_json TEXT;
