import type { Env } from "./lib/types.js";
import { runIngestion } from "./ingestion/run.js";
import { runScoring } from "./scoring/run.js";
import { getLatestRankings } from "./lib/db.js";

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
      return json({ horizon, rankings, excluded, disclaimer: DISCLAIMER });
    }

    if (url.pathname === "/ingest" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      const summary = await runIngestion(env);
      return json({ summary });
    }

    if (url.pathname === "/score" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      const summary = await runScoring(env);
      return json({ summary });
    }

    if (url.pathname === "/healthz") {
      return json({ ok: true });
    }

    return json(
      {
        service: "stock-agent",
        endpoints: {
          "GET /rankings?horizon=short|mid|long": "latest ranked watchlist",
          "POST /ingest": "manually trigger data ingestion (normally runs on the cron schedule)",
          "POST /score": "manually trigger rescoring against current data",
          "GET /healthz": "health check",
        },
        disclaimer: DISCLAIMER,
      },
      200
    );
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runIngestion(env);
    await runScoring(env);
  },
};
