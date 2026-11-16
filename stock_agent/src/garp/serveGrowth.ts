// Worker-side entry for the Growth GARP checker: serves GET /garp-growth.json
// for the dashboard's "Growth GARP" flyout. Same engine as src/garp/serve.ts
// (defensive) -- same valuation/render/live-price code -- pointed at the
// separate config/garp-growth/latest.json bundle (written by
// scripts/garp-growth-report.sh) instead. Writes nothing; shares nothing
// with scoring, decisions, or the Defensive GARP checker's own data.
import latest from "../../config/garp-growth/latest.json";
import { TOP_N, computeAll, shownRows } from "./valuation.js";
import { renderReport } from "./render.js";
import type { Conclusion, ResearchFile } from "./types.js";
import { fetchLiveQuotes, overlayLivePrices } from "./livePrices.js";

interface Bundle {
  runAt: string;
  title: string;
  files: ResearchFile[];
  conclusion: Conclusion | null;
}

export async function garpGrowthPayload(db?: D1Database) {
  const b = latest as unknown as Bundle;
  let files = b.files;
  let live: Record<string, string> = {};
  let skipped: Record<string, string> = {};
  let liveError: string | null = null;
  if (db && files.length) {
    try {
      const quotes = await fetchLiveQuotes(db, files.map((f) => f.ticker));
      ({ files, live, skipped } = overlayLivePrices(files, quotes));
    } catch (err) {
      liveError = String((err as Error).message ?? err); // fall back to researched prices
    }
  }
  const all = computeAll(files);
  const rows = shownRows(all); // top 5 Nordic / top 10 global (TOP_N); the rest stay in the bundle only
  const liveCount = Object.keys(live).length;
  const note = liveCount
    ? `Live prices from the agent's daily data for ${liveCount} of ${files.length} stocks (latest ${Object.values(live).sort().slice(-1)[0]}); others as researched. Fair values unchanged since the run.`
    : files.length
      ? "Prices as researched at the run."
      : "No growth stocks researched yet.";
  return {
    runAt: b.runAt,
    title: b.title,
    researched: all.length,
    topN: TOP_N,
    livePrices: live,
    liveSkipped: skipped,
    liveError,
    rows,
    conclusion: b.conclusion,
    html: renderReport(files, all, b.conclusion, b.runAt, b.title, note, false),
  };
}
