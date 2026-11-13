import type { Env } from "./lib/types.js";
import { runIngestion, loadFullUniverse } from "./ingestion/run.js";
import { runBenchmarkIngestion, loadBenchmarks } from "./ingestion/benchmarks.js";
import { runBroadScreen } from "./screening/run.js";
import { runMarketAnalysis } from "./analyst/run.js";
import { serveAsset } from "./lib/assets.js";
import { runScoring } from "./scoring/run.js";
import {
  getLatestDecisionRunAt,
  getLatestDecisions,
  getLatestRankings,
  getRecentBacktestRuns,
  pruneOldSnapshots,
} from "./lib/db.js";
import { renderDecisionLab } from "./decisionLab.js";
import { garpPayload } from "./garp/serve.js";
import { CHART_RANGES, fetchChartSeries, isChartRange } from "./lib/chart.js";
import { runDecisions } from "./decision/run.js";
import { getAllActiveWeights, getWeightHistory, setActiveWeights } from "./decision/weights.js";
import { HORIZONS, type DecisionHorizon, type WeightVector } from "./decision/types.js";
import { newUsage, formatBytes, estimateD1WriteCostUsd, formatCostUsd } from "./lib/usage.js";

function isDecisionHorizon(v: string): v is DecisionHorizon {
  return (HORIZONS as readonly string[]).includes(v);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Newline-delimited JSON ("NDJSON") streaming response for the dashboard's
// "Run & update" admin panel: each manual trigger below can emit a
// { type: "progress", ... } line per ticker/step as it works, so the panel
// shows live progress instead of one opaque spinner, ending with exactly
// one { type: "done" | "error", ... } line. Returning the Response here
// does not wait for `run` to finish -- the Workers runtime keeps this
// request alive for as long as the client keeps reading the stream, which
// is also what lets the client "stop" a run just by aborting its fetch.
function streamingNdjson(run: (emit: (event: Record<string, unknown>) => void) => Promise<void>): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const emit = (event: Record<string, unknown>) => {
    writer.write(encoder.encode(JSON.stringify(event) + "\n")).catch(() => {});
  };
  (async () => {
    try {
      await run(emit);
    } catch (err) {
      emit({ type: "error", error: (err as Error).message });
    } finally {
      writer.close().catch(() => {});
    }
  })();
  return new Response(readable, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
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
      const currencyByTicker = new Map((await loadFullUniverse(env)).map((u) => [u.ticker, u.currency]));
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
      const universe = await loadFullUniverse(env);
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
        tickers: tickers.map((t) => ({ ticker: t.ticker, name: t.name ?? null, exchange: t.exchange, currency: t.currency })),
      }));
      // Benchmark metadata for the dashboard's "filter by benchmark" control --
      // regimeProxyFor names which universe region(s) each index is the
      // natural benchmark for (config/benchmarks.json); the dashboard
      // resolves that against `regions` above itself rather than this
      // endpoint pre-joining the two, so it stays one source of truth.
      const benchmarks = loadBenchmarks().map((b) => ({
        ticker: b.ticker,
        name: b.name,
        regimeProxyFor: b.regime_proxy_for,
      }));
      return json({ totalTickers: universe.length, regions, benchmarks });
    }

    if (url.pathname === "/ingest" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      const mode = url.searchParams.get("mode") === "incremental" ? "incremental" : "full";
      return streamingNdjson(async (emit) => {
        const usage = newUsage();
        const summary = await runIngestion(env, { mode }, usage, (p) => emit({ type: "progress", source: "Yahoo Finance -> D1", ...p, downloadedLabel: formatBytes(p.downloadedBytes) }));
        const rowsWritten = summary.priceBarsWritten + summary.fundamentalsWritten + summary.valuationsWritten;
        const costUsd = estimateD1WriteCostUsd(rowsWritten);
        emit({
          type: "done",
          summary,
          source: "Yahoo Finance -> D1",
          downloadedBytes: usage.downloadedBytes,
          downloadedLabel: formatBytes(usage.downloadedBytes),
          rowsWritten,
          costUsd,
          costLabel: formatCostUsd(costUsd),
        });
      });
    }

    if (url.pathname === "/ingest-benchmarks" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      return streamingNdjson(async (emit) => {
        const usage = newUsage();
        const summary = await runBenchmarkIngestion(env, {}, usage, (p) => emit({ type: "progress", source: "Yahoo Finance -> D1", ...p, downloadedLabel: formatBytes(p.downloadedBytes) }));
        const costUsd = estimateD1WriteCostUsd(summary.priceBarsWritten);
        emit({
          type: "done",
          summary,
          source: "Yahoo Finance -> D1",
          downloadedBytes: usage.downloadedBytes,
          downloadedLabel: formatBytes(usage.downloadedBytes),
          rowsWritten: summary.priceBarsWritten,
          costUsd,
          costLabel: formatCostUsd(costUsd),
        });
      });
    }

    if (url.pathname === "/screen-broad-universe" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      return streamingNdjson(async (emit) => {
        const usage = newUsage();
        const summary = await runBroadScreen(env, {}, usage, (p) => emit({ type: "progress", source: "Yahoo Finance -> D1", ...p, downloadedLabel: formatBytes(p.downloadedBytes) }));
        const costUsd = estimateD1WriteCostUsd(summary.candidatesScored);
        emit({
          type: "done",
          summary,
          source: "Yahoo Finance -> D1",
          downloadedBytes: usage.downloadedBytes,
          downloadedLabel: formatBytes(usage.downloadedBytes),
          rowsWritten: summary.candidatesScored,
          costUsd,
          costLabel: formatCostUsd(costUsd),
        });
      });
    }

    if (url.pathname === "/score" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      return streamingNdjson(async (emit) => {
        const summary = await runScoring(env, (p) => emit({ type: "progress", source: "D1 (no external fetch)", ...p, downloadedLabel: formatBytes(p.downloadedBytes) }));
        const costUsd = estimateD1WriteCostUsd(summary.rankingsWritten);
        emit({
          type: "done",
          summary,
          source: "D1 (no external fetch)",
          downloadedBytes: 0,
          downloadedLabel: formatBytes(0),
          rowsWritten: summary.rankingsWritten,
          costUsd,
          costLabel: formatCostUsd(costUsd),
        });
      });
    }

    if (url.pathname === "/market-analysis" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      return streamingNdjson(async (emit) => {
        emit({ type: "progress", source: "D1 -> Anthropic API", step: "Calling the LLM for synthesis\u2026", index: 0, total: 1, downloadedBytes: 0, downloadedLabel: formatBytes(0) });
        const result = await runMarketAnalysis(env);
        emit({ type: "done", summary: result, source: "D1 -> Anthropic API", downloadedBytes: 0, downloadedLabel: formatBytes(0), rowsWritten: 0, costUsd: 0, costLabel: "Billed separately against your Anthropic Console spend limit, not Cloudflare -- see README" });
      });
    }

    if (url.pathname === "/trigger-backtest" && request.method === "POST") {
      // Kicks off the existing .github/workflows/backtest.yml workflow
      // on demand (it already runs weekly on its own schedule, and is
      // already runnable by hand from the GitHub Actions tab -- this just
      // exposes that same workflow_dispatch call from the dashboard). The
      // backtest harness itself (scripts/backtest.sh: Python, up to ~180
      // minutes, needs real Cloudflare credentials for the D1 export/
      // publish steps) cannot run inside this Worker -- this endpoint only
      // asks GitHub to start that run elsewhere; it does not wait for it
      // or report its result. Check the Actions tab, or the Model Results
      // tab once backtest.sh's publish step has run, for the outcome.
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      if (!env.GITHUB_TOKEN) {
        return json({ error: "GITHUB_TOKEN not set -- see README \"Securing the manual endpoints\"" }, 503);
      }
      const ghResponse = await fetch(
        "https://api.github.com/repos/manpmanp/stock_market_agent/actions/workflows/backtest.yml/dispatches",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.GITHUB_TOKEN}`,
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            "user-agent": "stock-agent-worker",
          },
          body: JSON.stringify({ ref: "main" }),
        }
      );
      if (ghResponse.status !== 204) {
        const detail = await ghResponse.text().catch(() => "");
        return json({ error: `GitHub API returned ${ghResponse.status}`, detail }, 502);
      }
      return json({ ok: true, note: "Backtest workflow dispatched -- check the GitHub Actions tab for progress." });
    }

    if (url.pathname === "/chart") {
      const ticker = url.searchParams.get("ticker") ?? "";
      const range = url.searchParams.get("range") ?? "";
      // Restrict to the configured universe so this endpoint can't be used as an
      // open proxy for arbitrary Yahoo Finance lookups.
      if (!(await loadFullUniverse(env)).some((u) => u.ticker === ticker)) {
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

    if (url.pathname === "/decisions") {
      const horizon = url.searchParams.get("horizon") ?? "long";
      if (!isDecisionHorizon(horizon)) {
        return json({ error: `horizon must be one of: ${HORIZONS.join(", ")}` }, 400);
      }
      // This limit must cover the WHOLE configured + promoted universe, not
      // just a "top N" display cut -- the dashboard's own Decision Lab does
      // its own client-side "Show N more" pagination on top of whatever
      // this returns, and its ticker search/autocomplete can only find a
      // ticker that's actually in this response. A tighter limit here (it
      // used to be 200, against a universe that has since grown past that)
      // silently drops the lowest-scored tail of tickers for that horizon
      // from both display AND search -- which is what made some real
      // tracked tickers (e.g. WMT on some horizons) unsearchable even
      // though they're in config/universe.json and were ingested/scored
      // normally. Set well above the current universe size (~210) so
      // normal near-term growth doesn't silently reintroduce the same bug.
      const decisions = await getLatestDecisions(env, horizon, 500);
      const runAt = await getLatestDecisionRunAt(env);
      return json({ horizon, runAt, decisions, disclaimer: DISCLAIMER });
    }

    if (url.pathname === "/weights") {
      if (request.method === "GET") {
        const horizonParam = url.searchParams.get("horizon");
        if (horizonParam) {
          if (!isDecisionHorizon(horizonParam)) {
            return json({ error: `horizon must be one of: ${HORIZONS.join(", ")}` }, 400);
          }
          const history = await getWeightHistory(env, horizonParam, 20);
          return json({ horizon: horizonParam, history });
        }
        const active = await getAllActiveWeights(env);
        return json({ weights: active });
      }

      if (request.method === "POST") {
        if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
        let body: { horizon?: string; weights?: WeightVector; note?: string };
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid JSON body" }, 400);
        }
        if (!body.horizon || !isDecisionHorizon(body.horizon)) {
          return json({ error: `body.horizon must be one of: ${HORIZONS.join(", ")}` }, 400);
        }
        if (!body.weights) return json({ error: "body.weights is required" }, 400);
        try {
          await setActiveWeights(env, body.horizon, body.weights, body.note);
        } catch (err) {
          return json({ error: (err as Error).message }, 400);
        }
        return json({ ok: true, horizon: body.horizon });
      }
    }

    if (url.pathname === "/decide" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      return streamingNdjson(async (emit) => {
        const summary = await runDecisions(env, undefined, (p) => emit({ type: "progress", source: "D1 (plus one market-regime fetch)", ...p, downloadedLabel: formatBytes(p.downloadedBytes) }));
        const costUsd = estimateD1WriteCostUsd(summary.decisionsWritten);
        emit({
          type: "done",
          summary,
          source: "D1 (plus one market-regime fetch)",
          downloadedBytes: 0,
          downloadedLabel: formatBytes(0),
          rowsWritten: summary.decisionsWritten,
          costUsd,
          costLabel: formatCostUsd(costUsd),
        });
      });
    }

    if (url.pathname === "/backtest-results") {
      // Published by scripts/backtest.sh's last step (push-to-d1.ts) after
      // a local run of the walk-forward harness -- see
      // migrations/0007_backtest_runs.sql. Empty runs: [] until you've run
      // the backtest pipeline on your own machine at least once.
      const runs = await getRecentBacktestRuns(env, 10);
      return json({ runs });
    }

    if (url.pathname === "/dashboard") {
      return new Response(renderDecisionLab(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/garp.json") {
      // GARP checker (src/garp): read-only, bundled research data rendered by
      // its own deterministic engine. Shares nothing with scoring/decisions.
      return json(garpPayload());
    }

    if (url.pathname.startsWith("/assets/")) {
      const key = decodeURIComponent(url.pathname.slice("/assets/".length));
      return serveAsset(env, key);
    }

    if (url.pathname === "/healthz") {
      return json({ ok: true });
    }

    return json(
      {
        service: "stock-agent",
        endpoints: {
          "GET /dashboard": "the main graphical view -- 10-factor decision engine, tunable weights, model results, demo videos",
          "GET /universe": "configured ticker universe grouped by region, plus benchmark/index metadata (for the dashboard\u0027s benchmark filter)",
          "GET /rankings?horizon=short|mid|long": "latest v1 ranked watchlist (JSON) -- frozen fixed-weight baseline, no longer rendered as its own page",
          "GET /chart?ticker=&range=1h|1d|1w|1m|3m|6m|1y|3y|5y": "live price snapshot for one ticker (JSON)",
          "POST /ingest": "manually trigger data ingestion (normally runs on the cron schedule) -- streams NDJSON progress lines, see dashboard admin panel",
          "POST /ingest-benchmarks": "manually trigger market-index benchmark ingestion (normally runs on the daily cron only, see config/benchmarks.json) -- streams NDJSON progress",
          "POST /screen-broad-universe": "manually trigger the Stage A broad valuation/momentum screen + auto-promotion over config/broad-universe.json (normally runs on the daily cron only, before ingestion) -- streams NDJSON progress",
          "POST /score": "manually trigger v1 rescoring against current data -- streams NDJSON progress",
          "POST /market-analysis": "on-demand LLM synthesis across tracked tickers + benchmarks (ADMIN_TOKEN-gated, requires ANTHROPIC_API_KEY/ANTHROPIC_MODEL secrets) -- never sizing/orders, every claim grounded against real decision-engine data, see docs/agentic-architecture-proposal.md section 3",
          "POST /trigger-backtest": "manually dispatch the backtest.yml GitHub Actions workflow (ADMIN_TOKEN + GITHUB_TOKEN secrets required) -- does not run the harness itself here, just asks GitHub to start it; see Actions tab for progress",
          "GET /garp.json": "GARP checker (defensive growth-at-a-reasonable-price research, src/garp) -- bundled research, computed valuations and rendered report HTML for the dashboard's GARP Checker flyout; independent of scoring/decisions",
          "GET /backtest-results": "published walk-forward backtest runs (JSON), pushed by scripts/backtest.sh",
          "GET /decisions?horizon=short|medium|long": "latest decision-engine output (JSON)",
          "GET /weights[?horizon=]": "active (or per-horizon history of) decision-engine weight vectors",
          "POST /weights": "set a new active weight vector for one horizon (admin token required)",
          "POST /decide": "manually trigger the decision engine against current data -- streams NDJSON progress",
          "GET /assets/<key>": "static assets served from R2 (currently the Decision Lab demo videos) -- see README \"Demo videos\"",
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
    // Runs before ingestion (full-run days only) so any newly auto-promoted
    // ticker is already in promoted_tickers -- and therefore in
    // loadFullUniverse()'s result -- by the time runIngestion reads the
    // universe a few lines down, letting it get fully ingested the same day
    // instead of waiting until tomorrow's run.
    if (isFullRun) {
      try {
        await runBroadScreen(env);
      } catch (err) {
        console.error("runBroadScreen failed", err);
      }
    }
    await runIngestion(env, { mode: isFullRun ? "full" : "incremental" });
    // Benchmarks only need the daily cadence -- index-level price history
    // doesn't need hourly freshness, and this keeps the hourly incremental
    // run (30s CPU budget on Cloudflare Workers Paid) untouched. A failure
    // here must never take down stock ingestion/scoring, so it's isolated.
    if (isFullRun) {
      try {
        await runBenchmarkIngestion(env);
      } catch (err) {
        console.error("runBenchmarkIngestion failed", err);
      }
    }
    await runScoring(env);
    // Runs after scoring so it reuses the technical_snapshot rows scoring
    // just refreshed (see decision/run.ts) rather than recomputing them.
    // A failure here should never take down the existing v1 rankings pipeline
    // above, so it's isolated in its own try/catch.
    try {
      await runDecisions(env);
    } catch (err) {
      console.error("runDecisions failed", err);
    }
    if (isFullRun) await pruneOldSnapshots(env);
  },
};
