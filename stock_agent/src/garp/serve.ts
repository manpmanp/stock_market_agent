// Worker-side entry for the GARP checker: serves GET /garp.json for the
// dashboard's "GARP Checker" flyout. Reads only the bundled
// config/garp/latest.json (written by scripts/garp-report.sh); no D1, no
// network, nothing shared with scoring or decisions.
import latest from "../../config/garp/latest.json";
import { TOP_N, computeAll, shownRows } from "./valuation.js";
import { renderReport } from "./render.js";
import type { Conclusion, ResearchFile } from "./types.js";

interface Bundle {
  runAt: string;
  title: string;
  files: ResearchFile[];
  conclusion: Conclusion | null;
}

export function garpPayload() {
  const b = latest as unknown as Bundle;
  const all = computeAll(b.files);
  const rows = shownRows(all); // top 5 Nordic / top 10 global (TOP_N); the rest stay in the bundle only
  return {
    runAt: b.runAt,
    title: b.title,
    researched: all.length,
    topN: TOP_N,
    rows,
    conclusion: b.conclusion,
    html: renderReport(b.files, all, b.conclusion, b.runAt, b.title),
  };
}
