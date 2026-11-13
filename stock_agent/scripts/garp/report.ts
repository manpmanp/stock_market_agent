// GARP report CLI: reads config/garp/research/*.json (+ optional
// config/garp/conclusion.json), runs the deterministic engine, writes
// config/garp/runs/<date>.json, reports/garp-<date>.html and
// config/garp/latest.json (the bundle the Worker serves at /garp.json).
// Run via scripts/garp-report.sh. Touches no agent files, D1 or network.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { computeAll } from "../../src/garp/valuation.js";
import { renderReport } from "../../src/garp/render.js";
import type { Conclusion, ResearchFile } from "../../src/garp/types.js";

const root = process.cwd();
const dir = join(root, "config/garp/research");
const files: ResearchFile[] = readdirSync(dir)
  .filter((n) => n.endsWith(".json"))
  .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")) as ResearchFile);

const missing = files.filter((f) => !f.valuation).map((f) => f.ticker);
if (missing.length) console.warn(`No valuation block yet (skipped): ${missing.join(", ")}`);

const rows = computeAll(files);
const conclPath = join(root, "config/garp/conclusion.json");
const conclusion: Conclusion | null = existsSync(conclPath) ? JSON.parse(readFileSync(conclPath, "utf8")) : null;
if (conclusion) {
  const known = new Set(rows.map((r) => r.ticker));
  for (const p of conclusion.picks) if (p.ticker && !known.has(p.ticker)) throw new Error(`conclusion pick ${p.ticker} not in run`);
}

const runAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
const title = process.env.GARP_TITLE ?? "Defensive GARP research: top 5 Nordic and top 5 global";
mkdirSync(join(root, "config/garp/runs"), { recursive: true });
mkdirSync(join(root, "reports"), { recursive: true });
writeFileSync(join(root, `config/garp/runs/${date}.json`), JSON.stringify({ runAt, rows }, null, 2));
writeFileSync(join(root, `reports/garp-${date}.html`), renderReport(files, rows, conclusion, runAt, title));
// Bundle read by the Worker (src/garp/serve.ts) for the dashboard's GARP
// Checker flyout. Inputs only; the Worker re-renders with the same engine.
writeFileSync(join(root, "config/garp/latest.json"), JSON.stringify({ runAt, title, files, conclusion }, null, 1));

for (const r of rows)
  console.log(
    `${String(r.rank).padStart(2)} ${r.ticker.padEnd(11)} ${r.entryStatus.padEnd(17)} price ${r.price.toFixed(1).padStart(8)} FV ${r.weightedFairValue.toFixed(1).padStart(8)} MoS ${(r.marginOfSafety * 100).toFixed(0).padStart(4)}% ret5y ${(r.return5y.total * 100).toFixed(1).padStart(5)}% score ${r.composite.toFixed(0)}`,
  );
console.log(`Wrote config/garp/runs/${date}.json and reports/garp-${date}.html`);
