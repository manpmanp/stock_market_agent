#!/bin/bash
# GARP checker: runs the tests for the GARP engine, then computes valuations
# and renders the report from config/garp/research/*.json.
# Local only: no Cloudflare credentials, no D1, no network. Does not touch
# the agent's scoring, decisions or data.
# Usage (from stock_agent/):  bash scripts/garp-report.sh
set -euo pipefail
cd "$(dirname "$0")/.."

npx vitest run test/garp --reporter=dot
npx --yes tsx scripts/garp/report.ts
