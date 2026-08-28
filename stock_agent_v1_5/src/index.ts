import type { Env } from "./lib/types.js";
import { runIngestion, loadUniverse } from "./ingestion/run.js";
import { runScoring } from "./scoring/run.js";
import { getLatestRankings, pruneOldSnapshots } from "./lib/db.js";
import { renderDashboard } from "./dashboard.js";
import { CHART_RANGES, fetchChartSeries, isChartRange } from "./lib/chart.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false; // unset = closed, not open. Set with `wrangler secret put ADMIN_TOKEN`.
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${env.ADMIN_TOKEN}`;
}

const DISCLAIMER =
  "Data-driven research output, not investment advice. Scores reflect the configured formula against currently available data and do not guarantee future returns.";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/rankings") {
      const horizon = url.searchParams.get("horizon") ?? "long";
      if (!["short", "mid", "long"].includes(horizon)) {
        return json({ error: "horizon must be short, mid, or long" }, 400);
      }
      const rankings = await getLatestRankings(env, horizon, 20);
      const excluded = await getLatestRankings(env, "excluded", 100);
      // Currency isn't stored on the rankings row itself -- it's a static per-ticker
      // fact from the universe config, so it's cheaper to attach it here than to
      // join it in every scoring query.
      const currencyByTicker = new Map(loadUniverse().map((u) => [u.ticker, u.currency]));
      const withCurrency = (rows: Array<Record<string, unknown>>) =>
        rows.map((r) => ({ ...r, currency: currencyByTicker.get(r.ticker as string) ?? null }));
      return json({ horizon, rankings: withCurrency(rankings), excluded: withCurrency(excluded), disclaimer: DISCLAIMER });
    }

    if (url.pathname === "/universe") {
      // Groups the configured universe by region for the dashboard's "Indexes"
      // box -- purely descriptive of what's being tracked, no scoring here.
      const REGION_LABELS: Record<string, string> = {
        nordic: "Sweden (OMXS30 + Indutrade)",
        us: "United States (Dow 30 + mega-caps + quality/healthcare/financials)",
        germany: "Germany (DAX, top 20 by market cap)",
        uk: "United Kingdom (FTSE 100, top ~20 by market cap)",
        nordic_ex_sweden: "Nordic ex-Sweden (Denmark, Finland, Norway)",
        switzerland: "Switzerland (SIX blue chips)",
        europe: "Europe ex-Germany (France, Netherlands, Italy, Spain)",
        japan: "Japan (US-listed only)",
        emerging_markets: "Emerging Markets (US-listed only)",
        global: "Other",
      };
      const universe = loadUniverse();
      const byRegion = new Map<string, typeof universe>();
      for (const entry of universe) {
        const list = byRegion.get(entry.region) ?? [];
        list.push(entry);
        byRegion.set(entry.region, list);
      }
      const regions = Array.from(byRegion.entries()).map(([region, tickers]) => ({
        region,
        label: REGION_LABELS[region] ?? region,
        count: tickers.length,
        tickers: tickers.map((t) => ({ ticker: t.ticker, exchange: t.exchange, currency: t.currency })),
      }));
      return json({ totalTickers: universe.length, regions });
    }

    if (url.pathname === "/ingest" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      const mode = url.searchParams.get("mode") === "incremental" ? "incremental" : "full";
      const summary = await runIngestion(env, { mode });
      return json({ summary });
    }

    if (url.pathname === "/score" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      const summary = await runScoring(env);
      return json({ summary });
    }

    if (url.pathname === "/chart") {
      const ticker = url.searchParams.get("ticker") ?? "";
      const range = url.searchParams.get("range") ?? "";
      // Restrict to the configured universe so this endpoint can't be used as an
      // open proxy for arbitrary Yahoo Finance lookups.
      if (!loadUniverse().some((u) => u.ticker === ticker)) {
        return json({ error: "unknown ticker" }, 400);
      }
      if (!isChartRange(range)) {
        return json({ error: `range must be one of: ${CHART_RANGES.join(", ")}` }, 400);
      }

      // Edge-cached per ticker+range so repeat dashboard loads (and multiple
      // viewers) don't each trigger a fresh Yahoo round-trip.
      const cacheKey = new Request(url.toString(), request);
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const { points, cacheTtlSeconds } = await fetchChartSeries(ticker, range);
      const response = json({ ticker, range, points });
      response.headers.set("Cache-Control", `public, max-age=${cacheTtlSeconds}`);
      await cache.put(cacheKey, response.clone());
      return response;
    }

    if (url.pathname === "/healthz") {
      return json({ ok: true });
    }

    if (url.pathname === "/dashboard") {
      return new Response(renderDashboard(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return json(
      {
        service: "stock-agent",
        endpoints: {
          "GET /dashboard": "graphical view of the latest rankings",
          "GET /universe": "configured ticker universe, grouped by region",
          "GET /rankings?horizon=short|mid|long": "latest ranked watchlist (JSON)",
          "GET /chart?ticker=&range=1h|1d|1w|1m|3m|6m|1y|3y|5y": "live price snapshot for one ticker (JSON)",
          "POST /ingest": "manually trigger data ingestion (normally runs on the cron schedule)",
          "POST /score": "manually trigger rescoring against current data",
          "GET /healthz": "health check",
        },
        disclaimer: DISCLAIMER,
      },
      200
    );
  },

  // Two cron patterns are registered in wrangler.toml [triggers]: the daily
  // "0 6 * * *" runs a full backfill (5y price history + fundamentals/
  // valuation), the hourly "0 * * * *" runs the cheap incremental path
  // (last 5 days of price bars only). controller.cron tells us which one
  // fired this invocation. Pruning old snapshot/ranking/log rows only needs
  // to happen once a day, so it rides along with the full run.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const isFullRun = controller.cron === "0 6 * * *";
    await runIngestion(env, { mode: isFullRun ? "full" : "incremental" });
    await runScoring(env);
    if (isFullRun) await pruneOldSnapshots(env);
  },
};
