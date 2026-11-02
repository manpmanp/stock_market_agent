#!/bin/bash
# Recomputes technical indicators + rankings from data already in D1.
# Does NOT fetch new data from Yahoo Finance -- run ingest.sh first for that.
set -euo pipefail

WORKER_URL="https://stock-agent.manp-dev.workers.dev"
TOKEN_FILE="$HOME/.cloudflare_stock_agent_token"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "Error: token file not found at $TOKEN_FILE" >&2
  echo "Create it with: echo -n \"your-token\" > $TOKEN_FILE && chmod 600 $TOKEN_FILE" >&2
  exit 1
fi

curl -sS -X POST "$WORKER_URL/score" \
  -H "Authorization: Bearer $(cat "$TOKEN_FILE")"
echo
