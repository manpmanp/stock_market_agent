-- Switches scoring from cross-sectional (vs the other 19 tickers) to
-- self-relative (vs each stock's own history). See src/scoring/score.ts
-- for the full rationale.

ALTER TABLE technical_snapshot ADD COLUMN price_range_pct REAL;   -- percentile [0,1] of latest close within this ticker's own multi-year range
ALTER TABLE technical_snapshot ADD COLUMN dist_from_high_pct REAL; -- % distance from this ticker's own high in the window (<= 0)
ALTER TABLE technical_snapshot ADD COLUMN dist_from_low_pct REAL;  -- % distance from this ticker's own low in the window (>= 0)
ALTER TABLE technical_snapshot ADD COLUMN trend_state TEXT;        -- 'pullback_in_uptrend' | 'near_historical_highs' | 'downtrend' | 'neutral'

ALTER TABLE rankings ADD COLUMN valuation_label TEXT; -- 'undervalued' | 'fair_value' | 'overvalued', vs this stock's own history
ALTER TABLE rankings ADD COLUMN quality_label TEXT;   -- 'strong' | 'adequate' | 'weak', vs fixed fundamental benchmarks
ALTER TABLE rankings ADD COLUMN entry_state TEXT;     -- mirrors technical_snapshot.trend_state at scoring time
