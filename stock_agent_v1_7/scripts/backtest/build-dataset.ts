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
