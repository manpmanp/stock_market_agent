// Point-in-time feature/label dataset builder for the v7 backtest harness.
//
// Reads per-ticker price history exported from D1 (see scripts/backtest.sh,
// which runs `wrangler d1 execute ... --json` once per ticker into
// data/raw/<ticker>.json -- one file per ticker, not one giant query, to
// stay well under D1's per-query response size and keep this robust for a
// 169-ticker universe) and replays the SAME indicator computation the live
// system uses (src/scoring/indicators.ts, imported directly -- not
// reimplemented here, so the backtest can never quietly drift from what
// production actually computes) at every historical date, using ONLY price
// data up to and including that date. That is what makes this point-in-time
// correct rather than lookahead-biased.
//
// For each (ticker, date) with enough trailing history, and for each
// horizon, it also looks the appropriate number of trading days FORWARD to
// compute the realized return -- the label. Feature computation only looks
// backward; label computation only looks forward from a date that has
// already "happened" in the walk -- the harness (harness.py) is the piece
// responsible for never training on a label whose forward window crosses
// into what it's being tested against (see the embargo logic there).
//
// Horizon-to-trading-days mapping. Nothing else in this project defines
// this precisely (the Weight Tuning "Short/Medium/Long" labels are
// qualitative), so this is this backtest's own explicit assumption:
//   short  = 10 trading days  (~2 calendar weeks)
//   medium = 60 trading days  (~3 calendar months)
//   long   = 252 trading days (~12 calendar months, one trading year)
// Adjust HORIZON_DAYS below if you intend something different -- everything
// downstream (harness.py's embargo gap sizing included) reads from this
// file's output, not from a hardcoded assumption of its own.
//
// Usage: npx tsx scripts/backtest/build-dataset.ts
//   reads:  data/raw/*.json         (one file per ticker, wrangler d1 --json shape)
//   writes: data/backtest_dataset.csv

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// NOTE: imported with an explicit .ts extension (not .js like the rest of
// this codebase) so this script can run directly under Node's native
// TypeScript support (`node script.ts`, no build step, no tsx/esbuild
// dependency) -- Node resolves .js-specifier-to-.ts-file the way a bundler
// does, but its native type-stripping does not, so it needs the real
// extension. This file is intentionally outside tsconfig.json's "include"
// (see there) so this doesn't conflict with the rest of the project's
// Bundler-resolution convention or its `npm run typecheck`.
import { computeIndicators, type PricePoint } from "../../src/scoring/indicators.ts";
// Same discipline as computeIndicators above: CALL the live decision-engine
// scoring functions, don't reimplement them. This file used to carry its
// own hand-copied factorEntry/factorTechnical/factorValuationPartial/
// factorRiskPartial functions with comments claiming they "match factors.ts
// exactly" -- and they silently stopped matching the first time factors.ts
// changed (scoreTechnical picked up conflict-aware RSI/trend blending;
// scoreRisk picked up a compounding-risk penalty) without anyone touching
// this file. That meant the backtest harness was quietly fitting weights
// and reporting correlations against a DIFFERENT, out-of-date algorithm
// than the one actually live on the site -- a hand-duplicated copy can
// only ever be as fresh as the last time someone remembered to update it.
// Importing computeFactorScores directly makes that drift structurally
// impossible: whatever factors.ts computes for entry/technical/valuation/
// risk IS what this dataset is built from, always, with no second copy to
// forget.
import { computeFactorScores, neutralMarketRegime } from "../../src/decision/factors.ts";
import type { UniverseSnapshotRow } from "../../src/lib/db.ts";
import type { TechnicalIndicators } from "../../src/scoring/indicators.ts";

const RAW_DIR = join(process.cwd(), "data", "raw");
const OUT_PATH = join(process.cwd(), "data", "backtest_dataset.csv");

const HORIZON_DAYS: Record<string, number> = {
  short: 10,
  medium: 60,
  long: 252,
};

// Same trailing-window cap the live system feeds computeIndicators (see
// src/scoring/run.ts: getLatestPriceHistory(env, ticker, 1300)) -- kept
// identical so the backtest measures the same feature computation
// production actually runs, not a wider or narrower lookback.
const MAX_LOOKBACK = 1300;

// Below this many trailing points, most indicators (SMA200 in particular)
// are still null -- skip emitting a row rather than emitting a mostly-empty
// feature vector that would just add noise to training.
const MIN_HISTORY = 260;

interface RawRow {
  ticker: string;
  date: string;
  close: number | null;
  volume: number | null;
}

/** wrangler d1 execute --json wraps results as `[{ results: [...] }]`;
 *  tolerate a plain array too in case the export shape ever changes. */
function extractRows(parsed: unknown): RawRow[] {
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const out: RawRow[] = [];
  for (const entry of arr) {
    const results = (entry as { results?: unknown[] })?.results ?? (Array.isArray(entry) ? entry : null);
    if (!results) continue;
    for (const r of results as Record<string, unknown>[]) {
      out.push({
        ticker: String(r.ticker),
        date: String(r.date),
        close: r.close === null || r.close === undefined ? null : Number(r.close),
        volume: r.volume === null || r.volume === undefined ? null : Number(r.volume),
      });
    }
  }
  return out;
}

function trendStateOneHot(state: string | null): { pullback: number; nearHigh: number; downtrend: number; neutral: number } {
  return {
    pullback: state === "pullback_in_uptrend" ? 1 : 0,
    nearHigh: state === "near_historical_highs" ? 1 : 0,
    downtrend: state === "downtrend" ? 1 : 0,
    neutral: state === "neutral" ? 1 : 0,
  };
}

function fmt(n: number | null): string {
  return n === null || Number.isNaN(n) ? "" : String(n);
}

// --- Decision Lab factor columns (point-in-time-clean subset only) -----
//
// src/decision/factors.ts computes 10 factor scores, but 6 of them (quality,
// growth, financial_strength, future_potential, catalyst, market_regime)
// need fundamentals or news data this project doesn't have a point-in-time
// history for yet (fundamentals_snapshot only recently stopped being
// pruned -- see src/lib/db.ts pruneOldSnapshots -- so real history is only
// now starting to accumulate). The 4 factors below are different: every
// input they need (RSI, MACD, SMA50/200, price-range percentile,
// volatility, distance from high, trend state) already comes from price
// history alone, which this dataset already computes point-in-time
// correctly. So these 4 can be fit honestly today, with no lookahead risk,
// while the fundamentals-dependent 6 wait for real history to accumulate.
//
// These 4 columns are read straight off computeFactorScores (imported
// above) instead of a hand-copied reimplementation -- a prior version of
// this file duplicated scoreEntry/scoreTechnical/scoreValuation/scoreRisk's
// math by hand, with a comment claiming each "matches factors.ts exactly."
// That claim silently went stale the first time factors.ts's scoring
// changed (scoreTechnical's RSI/trend conflict-aware blending, scoreRisk's
// compounding-risk penalty) without this file being touched -- meaning the
// backtest harness was quietly fitting weights and reporting correlations
// against an outdated algorithm, not the one actually live. Calling the
// real function makes that class of drift structurally impossible: there
// is no second copy of the math left to forget to update.
//
// The unused 6 fundamentals/news-dependent fields are passed as null,
// which computeFactorScores already handles by returning a flagged
// unscored=true neutral (50) for each -- exactly the same null-safe path
// the live engine takes for a ticker missing that data, so this isn't a
// special case, just the normal one. Only entry/technical/valuation/risk's
// .value are read out; valuation and risk come out as the SAME "partial"
// reads as before (valuation's fair-value-gap and EV/EBIT components, and
// risk's leverage/beta component, all naturally fall away to null/absent
// through the exact same null-guards, not a separately maintained "partial"
// formula) -- see factors.ts's scoreValuation/scoreRisk for how each
// degrades when those fundamentals inputs are missing.
const NEUTRAL_REGIME = neutralMarketRegime("backtest dataset: market regime isn't modeled point-in-time, not used by any of the 4 trainable factors");

function decisionFactorsFromIndicators(ticker: string, ind: TechnicalIndicators): { entry: number | null; technical: number | null; valuationPartial: number | null; riskPartial: number | null } {
  const row: UniverseSnapshotRow = {
    ticker,
    price: null, trailing_pe: null, peg_ratio: null, price_to_book: null, ev_to_ebitda: null, fcf_yield: null,
    gross_margin: null, operating_margin: null, net_margin: null, return_on_equity: null,
    revenue_growth_yoy: null, earnings_growth_yoy: null, debt_to_equity: null, fair_value: null,
    num_analysts: null,
    rsi_14: ind.rsi14, macd: ind.macd, macd_signal: ind.macdSignal,
    price_vs_sma50: ind.priceVsSma50, price_vs_sma200: ind.priceVsSma200,
    volume_trend_20d: ind.volumeTrend20d, dividend_yield: null,
    volatility_30d: ind.volatility30d, price_range_pct: ind.priceRangePercentile,
    dist_from_high_pct: ind.distFromHighPct, dist_from_low_pct: ind.distFromLowPct,
    trend_state: ind.trendState,
    beta: null, return_on_assets: null, ebit: null, ebitda: null, enterprise_value: null,
    total_debt: null, total_cash: null, interest_expense: null, payout_ratio: null,
    target_low: null, target_high: null, rating: null,
    rec_strong_buy: null, rec_buy: null, rec_hold: null, rec_sell: null, rec_strong_sell: null,
  };
  const details = computeFactorScores(row, NEUTRAL_REGIME);
  // computeFactorScores returns a flagged neutral 50 (unscored: true) for
  // missing data, not null -- the right behavior for the live UI (always
  // show SOME number), but the wrong one for training data: a fabricated
  // neutral would silently look like a real, informative reading to nnls/
  // the walk-forward harness instead of the missing value it actually is.
  // Map unscored back to null so harness.py's existing dropna(subset=...)
  // still excludes these rows, exactly like the old hand-copied functions
  // (which returned null on missing inputs) did.
  const val = (d: { value: number; unscored: boolean }) => (d.unscored ? null : d.value);
  return {
    entry: val(details.entry),
    technical: val(details.technical),
    valuationPartial: val(details.valuation),
    riskPartial: val(details.risk),
  };
}

function main() {
  let files: string[];
  try {
    files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    console.error(`No raw export found at ${RAW_DIR} -- run scripts/backtest.sh first (it populates data/raw/ from D1).`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`${RAW_DIR} is empty -- run scripts/backtest.sh first.`);
    process.exit(1);
  }

  const header = [
    "ticker", "date", "horizon",
    "rsi14", "macd", "macd_signal", "price_vs_sma50", "price_vs_sma200",
    "volatility_30d", "volume_trend_20d", "price_range_pct", "dist_from_high_pct", "dist_from_low_pct",
    "trend_pullback", "trend_near_high", "trend_downtrend", "trend_neutral",
    "factor_entry", "factor_technical", "factor_valuation_partial", "factor_risk_partial",
    "label_forward_return",
  ];
  const lines: string[] = [header.join(",")];

  let tickersProcessed = 0;
  let rowsEmitted = 0;
  let filesSkipped = 0;

  for (const file of files) {
    // A partial/failed export can leave an empty or truncated .json behind
    // (e.g. an interrupted scripts/backtest.sh run) -- skip that one file
    // rather than letting one bad ticker abort the whole build. The export
    // step itself now avoids writing these in the first place, but this
    // stays defensive in case a file got here some other way.
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(RAW_DIR, file), "utf8"));
    } catch (err) {
      console.warn(`Skipping ${file}: not valid JSON (${(err as Error).message}) -- re-run scripts/backtest.sh to retry this ticker's export.`);
      filesSkipped++;
      continue;
    }
    const rows = extractRows(parsed)
      .filter((r) => r.close !== null)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (rows.length < MIN_HISTORY) continue;

    const ticker = rows[0]!.ticker;
    tickersProcessed++;

    for (let i = MIN_HISTORY - 1; i < rows.length; i++) {
      const windowStart = Math.max(0, i - MAX_LOOKBACK + 1);
      const points: PricePoint[] = rows.slice(windowStart, i + 1).map((r) => ({ date: r.date, close: r.close as number, volume: r.volume }));
      const ind = computeIndicators(points);
      if (ind.asOfDate === null) continue;
      const t = trendStateOneHot(ind.trendState);
      const currentClose = rows[i]!.close as number;
      const decisionFactors = decisionFactorsFromIndicators(ticker, ind);
      const fEntry = decisionFactors.entry;
      const fTechnical = decisionFactors.technical;
      const fValuationPartial = decisionFactors.valuationPartial;
      const fRiskPartial = decisionFactors.riskPartial;

      for (const [horizon, days] of Object.entries(HORIZON_DAYS)) {
        const futureIdx = i + days;
        if (futureIdx >= rows.length) continue; // no realized outcome yet within the exported history
        const futureClose = rows[futureIdx]!.close;
        if (futureClose === null) continue;
        const label = (futureClose - currentClose) / currentClose;

        lines.push([
          ticker, rows[i]!.date, horizon,
          fmt(ind.rsi14), fmt(ind.macd), fmt(ind.macdSignal), fmt(ind.priceVsSma50), fmt(ind.priceVsSma200),
          fmt(ind.volatility30d), fmt(ind.volumeTrend20d), fmt(ind.priceRangePercentile), fmt(ind.distFromHighPct), fmt(ind.distFromLowPct),
          String(t.pullback), String(t.nearHigh), String(t.downtrend), String(t.neutral),
          fmt(fEntry), fmt(fTechnical), fmt(fValuationPartial), fmt(fRiskPartial),
          fmt(label),
        ].join(","));
        rowsEmitted++;
      }
    }
  }

  writeFileSync(OUT_PATH, lines.join("\n") + "\n");
  console.log(`Wrote ${rowsEmitted} rows across ${tickersProcessed} tickers -> ${OUT_PATH}` + (filesSkipped > 0 ? ` (${filesSkipped} raw file(s) skipped as unparseable -- see warnings above)` : ""));
  if (tickersProcessed === 0) {
    console.error("No ticker had enough history (>= " + MIN_HISTORY + " trading days) -- nothing usable was exported.");
    process.exit(1);
  }
}

main();
