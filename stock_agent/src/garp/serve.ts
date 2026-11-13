// Worker-side entry for the GARP checker: serves GET /garp.json for the
// dashboard's "GARP Checker" flyout. Reads only the bundled
// config/garp/latest.json (written by scripts/garp-report.sh); no D1, no
// network, nothing shared with scoring or decisions.
import latest from "../../config/garp/latest.json";
import { computeAll } from "./valuation.js";
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
  const rows = computeAll(b.files);
  return {
    runAt: b.runAt,
    title: b.title,
    rows,
    conclusion: b.conclusion,
    html: renderReport(b.files, rows, b.conclusion, b.runAt, b.title),
  };
}
