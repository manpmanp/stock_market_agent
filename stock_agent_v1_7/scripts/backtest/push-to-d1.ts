// Turns the harness's data/backtest_report.json into a small .sql file
// that scripts/backtest.sh then runs against D1 with
// `wrangler d1 execute --remote --file=...` -- that's what makes a run
// show up on the live /decision-lab "Model Results" tab (see
// migrations/0007_backtest_runs.sql and src/index.ts's /backtest-results
// route). Writing a .sql file rather than an inline --command keeps this
// safe regardless of the report's size or quoting, and matches how
// migrations themselves are already applied in this project.
//
// Also prunes backtest_runs down to the most recent KEEP_RUNS rows in the
// same .sql file, so repeated backtest runs don't grow the table
// unbounded on the D1 free tier.
//
// NOTE: same native-Node-TypeScript convention as build-dataset.ts --
// run directly with `node`, imported with the real .ts extension where
// relevant, outside tsconfig.json's "include". No imports from the rest
// of the codebase are needed here, so there's nothing to get wrong on
// that front, but the convention is kept for consistency.
//
// Usage: node scripts/backtest/push-to-d1.ts
//   reads:  data/backtest_report.json
//   writes: data/.push-backtest.sql

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPORT_PATH = join(process.cwd(), "data", "backtest_report.json");
const OUT_SQL = join(process.cwd(), "data", ".push-backtest.sql");
const KEEP_RUNS = 20;

function main() {
  let raw: string;
  try {
    raw = readFileSync(REPORT_PATH, "utf8");
  } catch {
    console.error(`${REPORT_PATH} not found -- run scripts/backtest/harness.py first (scripts/backtest.sh does this for you).`);
    process.exit(1);
  }

  // Fail loudly on malformed JSON rather than publishing garbage to D1.
  try {
    JSON.parse(raw);
  } catch (err) {
    console.error(`${REPORT_PATH} is not valid JSON (${(err as Error).message}) -- not publishing.`);
    process.exit(1);
  }

  const createdAt = new Date().toISOString();
  const escapedJson = raw.replace(/'/g, "''"); // SQL single-quote escaping
  const sql = [
    `INSERT INTO backtest_runs (created_at, report_json) VALUES ('${createdAt}', '${escapedJson}');`,
    `DELETE FROM backtest_runs WHERE id NOT IN (SELECT id FROM backtest_runs ORDER BY id DESC LIMIT ${KEEP_RUNS});`,
    "",
  ].join("\n");

  writeFileSync(OUT_SQL, sql);
  console.log(`Wrote ${OUT_SQL} (run created_at=${createdAt}, ${(raw.length / 1024).toFixed(1)} KiB report) -- next: wrangler d1 execute --file=${OUT_SQL}`);
}

main();
