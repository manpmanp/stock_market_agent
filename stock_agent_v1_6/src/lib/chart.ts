// Live, on-demand price snapshots for the dashboard's per-ticker charts.
// Deliberately NOT stored in D1 -- this is a thin proxy over Yahoo's chart
// endpoint with a short edge cache (see index.ts GET /chart), separate from
// the daily price_history table that scoring reads. "Live" here means "as
// fresh as Yahoo's free/unofficial endpoint gets", which for intraday data
// is typically delayed 15-20 minutes, not real-time -- worth knowing before
// reading the 1h/1d views as tick-by-tick.
import { fetchChart } from "./yahoo.js";
import { parseChartPoints, type ChartPoint } from "./parse.js";

export const CHART_RANGES = ["1h", "1d", "1w", "1m", "3m", "6m", "1y", "3y", "5y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

export function isChartRange(v: string): v is ChartRange {
  return (CHART_RANGES as readonly string[]).includes(v);
}

interface RangeConfig {
  range: string; // Yahoo chart "range" param
  interval: string; // Yahoo chart "interval" param
  cacheTtlSeconds: number; // shorter for intraday (changes fast), longer for multi-year (barely changes)
  sliceMinutes?: number; // for "1h": Yahoo has no native "last 60 minutes" range, so over-fetch and slice
}

const RANGE_CONFIG: Record<ChartRange, RangeConfig> = {
  "1h": { range: "1d", interval: "2m", cacheTtlSeconds: 60, sliceMinutes: 60 },
  "1d": { range: "1d", interval: "5m", cacheTtlSeconds: 60 },
  "1w": { range: "5d", interval: "15m", cacheTtlSeconds: 300 },
  "1m": { range: "1mo", interval: "1d", cacheTtlSeconds: 3600 },
  "3m": { range: "3mo", interval: "1d", cacheTtlSeconds: 3600 },
  "6m": { range: "6mo", interval: "1d", cacheTtlSeconds: 3600 },
  "1y": { range: "1y", interval: "1d", cacheTtlSeconds: 3600 },
  "3y": { range: "3y", interval: "1wk", cacheTtlSeconds: 21600 },
  "5y": { range: "5y", interval: "1wk", cacheTtlSeconds: 21600 },
};

export interface ChartSeriesResult {
  points: ChartPoint[];
  cacheTtlSeconds: number;
}

export async function fetchChartSeries(ticker: string, rangeKey: ChartRange): Promise<ChartSeriesResult> {
  const cfg = RANGE_CONFIG[rangeKey];
  const resp = await fetchChart(ticker, cfg.range, cfg.interval);
  let points = resp.ok && resp.data ? parseChartPoints(resp.data) : [];
  points = points.filter((p) => p.close !== null);
  if (cfg.sliceMinutes) {
    const cutoff = Date.now() - cfg.sliceMinutes * 60_000;
    points = points.filter((p) => new Date(p.t).getTime() >= cutoff);
  }
  return { points, cacheTtlSeconds: cfg.cacheTtlSeconds };
}
