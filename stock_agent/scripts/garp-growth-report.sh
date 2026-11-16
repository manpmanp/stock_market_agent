#!/bin/bash
# Growth GARP checker: same engine as scripts/garp-report.sh (defensive),
# applied to config/garp-growth/research/*.json instead.
# Local only: no Cloudflare credentials, no D1, no network. Does not touch
# the agent's scoring, decisions or data.
# Usage (from stock_agent/):  bash scripts/garp-growth-report.sh
set -euo pipefail
cd "$(dirname "$0")/.."

npx vitest run test/garp --reporter=dot
npx --yes tsx scripts/garp-growth/report.ts
echo "To show this run in the dashboard's Growth GARP tab: commit, then run bash scripts/deploy.sh"
