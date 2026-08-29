#!/bin/bash
# Pulls fresh price history + fundamentals from Yahoo Finance for the
# configured universe and writes it into D1. Run score.sh right after
# this to turn the new data into updated rankings.
set -euo pipefail

WORKER_URL="https://stock-agent.manp-dev.workers.dev"
TOKEN_FILE="$HOME/.cloudflare_stock_agent_token"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "Error: token file not found at $TOKEN_FILE" >&2
  echo "Create it with: echo -n \"your-token\" > $TOKEN_FILE && chmod 600 $TOKEN_FILE" >&2
  exit 1
fi

echo "Ingesting..."
curl -sS -X POST "$WORKER_URL/ingest" \
  -H "Authorization: Bearer $(cat "$TOKEN_FILE")"
echo
