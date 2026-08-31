#!/bin/bash
# Unattended wrapper around scripts/backtest.sh, meant to be run from cron
# (or launchd) on your Mac -- for everyday manual runs, use
# scripts/backtest.sh directly instead, it's simpler.
#
# What this adds on top of scripts/backtest.sh:
#   - stdin closed, so if anything tries to prompt interactively (e.g. a
#     TabPFN re-auth) this fails fast instead of hanging forever as a
#     zombie cron job
#   - a stale-safe lock file, so if one run is still going when the next
#     scheduled time arrives, the new one skips instead of running two
#     backtests over each other
#   - a hard wall-clock timeout (default 3h), so a genuinely stuck run gets
#     killed instead of accumulating forever
#   - every run's full output goes to a timestamped log in
#     logs/backtest/run-<timestamp>.log, with only the last KEEP_LOGS kept
#   - logs/backtest/last-status.txt always reflects just the most recent
#     run (SUCCESS/FAILED/TIMED OUT/SKIPPED + timestamp + log path), so you
#     can check at a glance without digging through logs
#   - a native macOS notification on failure (via osascript), if available
#   - PATH is widened to include common Homebrew/nvm locations, since cron
#     runs with a much more minimal PATH than your interactive Terminal
#
# One-time setup:
#   1. Run this once manually first to make sure it works end to end:
#        scripts/backtest-scheduled.sh
#      Then check logs/backtest/last-status.txt.
#   2. Add it to your crontab (`crontab -e`) to run weekly, e.g. Sunday 3am:
#        0 3 * * 0 cd /path/to/stock_agent_v1_7 && ./scripts/backtest-scheduled.sh >> logs/backtest/cron.log 2>&1
#      Replace /path/to/stock_agent_v1_7 with this repo's actual path
#      (run `pwd` in this directory to get it). Weekly is the suggested
#      default -- walk-forward folds don't move much day to day, and each
#      run costs real time (TabPFN + D1 export).
#
# Configuration (edit these variables directly, or set them as environment
# variables before invoking this script -- e.g. in the crontab line itself):
#   BACKTEST_ARGS   -- extra flags passed through to backtest.sh, e.g.
#                       "--no-tune" if a run is taking too long unattended
#   TIMEOUT_SECONDS -- hard kill after this many seconds (default 10800 = 3h)
#   KEEP_LOGS       -- how many past run logs to keep (default 10)

set -uo pipefail   # deliberately not -e: this script must always reach its
                    # own status-file/lock-cleanup/log-pruning steps below,
                    # even when the underlying backtest run fails.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

BACKTEST_ARGS="${BACKTEST_ARGS:-}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-10800}"
KEEP_LOGS="${KEEP_LOGS:-10}"

LOG_DIR="logs/backtest"
LOCK_FILE="$LOG_DIR/.run.lock"
STATUS_FILE="$LOG_DIR/last-status.txt"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/run-$TIMESTAMP.log"

mkdir -p "$LOG_DIR"

# --- Widen PATH before anything else. cron's default PATH is typically
#     just /usr/bin:/bin, which misses Homebrew, nvm, and similar -- the
#     same script that works fine typed into Terminal can fail from cron
#     purely because `node`/`npx`/`wrangler` aren't found. If this still
#     can't find node after adding the common locations below, add your
#     actual node bin directory here (find it with `which node` in your
#     normal interactive Terminal). ---
for extra in "/opt/homebrew/bin" "/usr/local/bin" "$HOME/.nvm/versions/node/*/bin"; do
  for expanded in $extra; do
    [ -d "$expanded" ] && PATH="$expanded:$PATH"
  done
done
export PATH

if ! command -v node >/dev/null 2>&1; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') FAILED (node not found on PATH -- edit the PATH section near the top of scripts/backtest-scheduled.sh to add your node install's bin dir; find it with 'which node')" > "$STATUS_FILE"
  exit 1
fi

# --- Stale-safe lock: a plain pidfile rather than `flock`, which isn't
#     reliably available on macOS by default. If the recorded PID is still
#     alive, another run is genuinely in progress and this one skips;
#     otherwise the lock is stale (e.g. the machine slept or restarted
#     mid-run) and gets reused rather than blocking forever. ---
if [ -f "$LOCK_FILE" ]; then
  OLD_PID="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') SKIPPED (previous run pid $OLD_PID still active)" > "$STATUS_FILE"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
cleanup() { rm -f "$LOCK_FILE"; }
trap cleanup EXIT

# --- Portable timeout with best-effort whole-process-group kill. Neither
#     GNU `timeout` nor a default `flock` ship on macOS, so this is done
#     with plain bash job control instead. `set -m` gives the backtest
#     run its own process group so a timeout can kill the whole subprocess
#     tree (wrangler, python, etc.), not just the top-level bash process. ---
set -m
run_with_timeout() {
  local seconds="$1"; shift
  "$@" &
  local pid=$!
  ( sleep "$seconds"; kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null ) &
  local watcher=$!
  wait "$pid" 2>/dev/null
  local status=$?
  kill "$watcher" 2>/dev/null || true
  wait "$watcher" 2>/dev/null || true
  return $status
}

{
  echo "== Scheduled backtest run: $TIMESTAMP =="
  echo "Args: ${BACKTEST_ARGS:-<none>} | timeout: ${TIMEOUT_SECONDS}s"
} >> "$LOG_FILE"

# stdin closed (< /dev/null): if anything downstream unexpectedly waits on
# interactive input (a TabPFN re-auth prompt, a venv-creation confirmation,
# etc.) it fails immediately instead of hanging as an orphaned cron job.
run_with_timeout "$TIMEOUT_SECONDS" bash scripts/backtest.sh $BACKTEST_ARGS < /dev/null >> "$LOG_FILE" 2>&1
STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') SUCCESS (log: $LOG_FILE)" > "$STATUS_FILE"
elif [ "$STATUS" -eq 143 ]; then
  echo "TIMED OUT after ${TIMEOUT_SECONDS}s" >> "$LOG_FILE"
  echo "$(date '+%Y-%m-%d %H:%M:%S') TIMED OUT after ${TIMEOUT_SECONDS}s (log: $LOG_FILE)" > "$STATUS_FILE"
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') FAILED exit=$STATUS (log: $LOG_FILE)" > "$STATUS_FILE"
fi

if [ "$STATUS" -ne 0 ] && command -v osascript >/dev/null 2>&1; then
  osascript -e "display notification \"Check logs/backtest/last-status.txt\" with title \"Stock agent backtest failed\"" >/dev/null 2>&1 || true
fi

# --- Prune old logs, keep only the most recent KEEP_LOGS. (Not using
#     `xargs -r` here -- that flag isn't supported by macOS's BSD xargs.) ---
LOG_COUNT="$(ls -1 "$LOG_DIR"/run-*.log 2>/dev/null | wc -l | tr -d ' ')"
if [ "$LOG_COUNT" -gt "$KEEP_LOGS" ]; then
  ls -t "$LOG_DIR"/run-*.log | tail -n +"$((KEEP_LOGS + 1))" | while IFS= read -r f; do rm -f "$f"; done
fi

exit "$STATUS"
