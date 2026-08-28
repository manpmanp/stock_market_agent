#!/bin/bash
# Convenience wrapper: ingest fresh data, then rescore. This is exactly
# what the daily cron does automatically at 06:00 UTC -- use this only
# when you want to force it manually in between.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== ingest =="
"$DIR/ingest.sh"
echo "== score =="
"$DIR/score.sh"
