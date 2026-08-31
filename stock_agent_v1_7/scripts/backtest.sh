#!/bin/bash
# v7 backtest pipeline: exports point-in-time price history from the live
# D1 database, builds the point-in-time feature/label dataset, runs the
# walk-forward model-comparison harness (linear / GBM / TabPFN) described on
# the /decision-lab Methodology -> Model Selection & Testing tab, and
# publishes the result to D1 so the live /decision-lab "Model Results" tab
# can actually show it -- not just describe the methodology in prose.
#
# Must run from your actual Mac Terminal, not through any bridged/sandboxed
# shell -- the D1 export and publish steps need your real `wrangler login`
# credentials, which only exist there.
#
# One-time prerequisite: `npm run db:migrate:remote` (adds the
# backtest_runs table -- migrations/0007_backtest_runs.sql). The publish
# step below checks for this and tells you if it's missing.
#
# Usage:
#   scripts/backtest.sh                 full pipeline: export -> dataset -> harness -> publish
#   scripts/backtest.sh --skip-export    reuse whatever's already in data/raw/
#                                        (fast iteration once you've exported once)
#   scripts/backtest.sh --python <path>  use a specific python3/venv interpreter
#   scripts/backtest.sh --no-tune        skip automatic hyperparameter tuning (fixed defaults,
#                                        noticeably faster -- see harness.py's inner_tune)
#
# First run installs Python deps (pandas/numpy/scipy/scikit-learn/tabpfn)
# into a local venv at .venv-backtest/ if one doesn't already exist. tabpfn
# pulls in torch and can take a while to download the first time -- that's
# expected. If it fails to install, the harness still runs with linear+GBM
# and says so; TabPFN just won't be part of that run's comparison.
#
# Linear and GBM's hyperparameters are tuned automatically per fold by
# default (a nested walk-forward search inside each fold's own training
# window -- see harness.py's inner_tune) so the chosen config can track
# new patterns as more history accumulates, rather than being fixed once.
# This makes the harness step meaningfully slower than before tuning
# existed, especially on a large universe -- use --no-tune for a quick
# iteration run if that matters more than the tuned result right now.
#
# For unattended/scheduled runs (e.g. a weekly cron job), use
# scripts/backtest-scheduled.sh instead of calling this script directly --
# it adds locking, a timeout, log rotation, and a status file on top of
# this script's own behavior.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

DB_NAME="stock-agent-db"
UNIVERSE_FILE="config/universe.json"
RAW_DIR="data/raw"
VENV_DIR=".venv-backtest"

SKIP_EXPORT=0
PYTHON_BIN=""
NO_TUNE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-export) SKIP_EXPORT=1; shift ;;
    --python) PYTHON_BIN="$2"; shift 2 ;;
    --no-tune) NO_TUNE=1; shift ;;
    -h|--help)
      sed -n '2,42p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (see --help)" >&2
      exit 1
      ;;
  esac
done

step() { echo; echo "== $1 =="; }

# --- 0. Make sure the local wrangler/workerd install actually matches this
#        machine before touching D1. node_modules only works correctly on
#        the platform it was `npm install`-ed on (workerd ships a native,
#        per-platform binary) -- if node_modules was ever installed or
#        copied from a different platform (e.g. via a Linux bridge/sandbox
#        rather than this Mac's own Terminal) every `npx wrangler ...` call
#        fails with "You installed workerd on another platform...", which is
#        exactly what breaks the export loop below for every single ticker.
#        Detect that specific failure and self-heal by reinstalling
#        node_modules right here, on the machine actually running this
#        script, instead of leaving you to debug 98 individual .err files. ---
if [ "$SKIP_EXPORT" != "1" ]; then
  step "Verifying local tooling matches this machine"
  if ! npx wrangler --version >/tmp/backtest-wrangler-check.$$ 2>&1; then
    if grep -qi "workerd on another platform\|platform-specific binary" /tmp/backtest-wrangler-check.$$; then
      echo "node_modules was installed for a different platform than this machine (this happens if it was ever npm-installed or copied in from elsewhere, e.g. a Linux sandbox) -- reinstalling it here so the native binaries match this machine."
      rm -rf node_modules
      npm install
      if ! npx wrangler --version >/dev/null 2>&1; then
        echo "Reinstalling node_modules didn't fix it -- please run 'npm install' yourself in this same terminal and re-run this script." >&2
        rm -f /tmp/backtest-wrangler-check.$$
        exit 1
      fi
      echo "node_modules reinstalled for this machine -- continuing."
    else
      echo "'npx wrangler --version' failed for a reason other than a platform mismatch:" >&2
      cat /tmp/backtest-wrangler-check.$$ >&2
      rm -f /tmp/backtest-wrangler-check.$$
      exit 1
    fi
  fi
  rm -f /tmp/backtest-wrangler-check.$$
fi

# --- 1. Export point-in-time price history from D1, one ticker at a time
#        (not one giant query) so a 169-ticker universe stays well under
#        D1's per-query response size. ---
if [ "$SKIP_EXPORT" = "1" ]; then
  step "Skipping D1 export (--skip-export) -- reusing $RAW_DIR"
  if [ ! -d "$RAW_DIR" ] || [ -z "$(ls -A "$RAW_DIR" 2>/dev/null)" ]; then
    echo "No existing export found at $RAW_DIR -- run without --skip-export first." >&2
    exit 1
  fi
else
  step "Exporting price history from D1 ($DB_NAME), one ticker at a time"
  mkdir -p "$RAW_DIR"
  TICKERS="$(node -e "console.log(require('./$UNIVERSE_FILE').tickers.map(t => t.ticker).join('\n'))")"
  COUNT=$(echo "$TICKERS" | wc -l | tr -d ' ')
  echo "Universe: $COUNT tickers"
  echo "Resumable: already-exported tickers (a valid, non-empty .json already in $RAW_DIR) are skipped -- delete a"
  echo "ticker's file (or the whole dir) to force re-exporting it. Safe to Ctrl-C and re-run this same command."
  i=0
  failed=0
  skipped=0
  while IFS= read -r TICKER; do
    i=$((i + 1))
    DEST="$RAW_DIR/${TICKER}.json"
    if [ -s "$DEST" ] && node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$DEST" >/dev/null 2>&1; then
      skipped=$((skipped + 1))
      printf "  [%d/%d] %s (already exported, skipping)\r" "$i" "$COUNT" "$TICKER"
      continue
    fi
    printf "  [%d/%d] %s\r" "$i" "$COUNT" "$TICKER"
    TMP="$RAW_DIR/.${TICKER}.tmp"
    if npx wrangler d1 execute "$DB_NAME" --remote --json \
        --command "SELECT ticker, date, close, volume FROM price_history WHERE ticker = '${TICKER}' ORDER BY date;" \
        > "$TMP" 2>"$RAW_DIR/.${TICKER}.err" \
      && [ -s "$TMP" ] \
      && node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$TMP" >/dev/null 2>&1; then
      mv "$TMP" "$DEST"
      rm -f "$RAW_DIR/.${TICKER}.err"
    else
      failed=$((failed + 1))
      rm -f "$TMP"
      echo
      echo "  Export failed for $TICKER -- see $RAW_DIR/.${TICKER}.err (not written to $DEST, so the dataset builder won't choke on it -- re-run this command to retry just this ticker)" >&2
    fi
  done <<< "$TICKERS"
  echo
  echo "Exported to $RAW_DIR/ ($skipped already had a valid export, $failed failed this run)"
  if [ "$failed" -gt 0 ]; then
    echo "Re-run 'scripts/backtest.sh' (without --skip-export) to retry just the failed tickers -- already-exported ones are skipped automatically."
  fi
fi

# --- 2. Build the point-in-time feature/label dataset (TypeScript, reuses
#        src/scoring/indicators.ts directly -- see build-dataset.ts). Runs
#        under Node's own native TypeScript support -- no tsx/esbuild
#        dependency, which avoids a whole class of "esbuild binary version
#        mismatch" install bugs. Node 22.6+ needs --experimental-strip-types;
#        Node 23.6+ (and the Node 26 this was verified against) runs it with
#        no flag at all -- try plain `node` first, fall back to the flag. ---
step "Building point-in-time dataset (node)"
if ! node scripts/backtest/build-dataset.ts 2>/tmp/backtest-node-err.$$; then
  if grep -qi "strip-types\|Unknown file extension\|Unexpected token" /tmp/backtest-node-err.$$; then
    echo "Plain 'node' couldn't run TypeScript directly on this Node version -- retrying with --experimental-strip-types."
    node --experimental-strip-types scripts/backtest/build-dataset.ts
  else
    cat /tmp/backtest-node-err.$$ >&2
    rm -f /tmp/backtest-node-err.$$
    exit 1
  fi
fi
rm -f /tmp/backtest-node-err.$$

# --- 3. Python environment for the walk-forward harness. ---
step "Python environment"
if [ -z "$PYTHON_BIN" ]; then
  # Don't just trust that $VENV_DIR existing means it's usable -- an
  # earlier run can leave a broken venv behind (e.g. created before Xcode
  # Command Line Tools had finished installing python3), and reusing it
  # silently is exactly what re-triggers the same "installing" prompt on
  # every subsequent run even after python3 itself is fixed. Validate it
  # actually runs; wipe and recreate if not.
  if [ -d "$VENV_DIR" ] && ! "$VENV_DIR/bin/python" --version >/dev/null 2>&1; then
    echo "$VENV_DIR exists but its python doesn't work (likely created before python3 was properly installed) -- recreating it."
    rm -rf "$VENV_DIR" 2>/dev/null || true
    if [ -d "$VENV_DIR" ]; then
      # rm -rf itself failed to fully remove it (seen in practice as
      # "Directory not empty", most likely iCloud Drive syncing files
      # inside this tree while we're trying to delete them). Don't fight
      # that -- reusing the same stuck path just repeats the same failure
      # (and re-triggers the same install prompt) on every re-run. Fall
      # back to a fresh, uniquely-named venv dir instead.
      NEW_VENV_DIR="${VENV_DIR}-$(date +%s)"
      echo "Couldn't fully remove $VENV_DIR (some files are likely locked, e.g. by iCloud Drive sync) -- using a fresh venv at $NEW_VENV_DIR instead. You can manually delete the old $VENV_DIR later once nothing has it locked." >&2
      VENV_DIR="$NEW_VENV_DIR"
    fi
  fi
  if [ ! -d "$VENV_DIR" ]; then
    if ! command -v python3 >/dev/null 2>&1 || ! python3 --version >/dev/null 2>&1; then
      echo "python3 isn't available yet on this machine -- install it (e.g. let Xcode Command Line Tools finish, or 'xcode-select --install'), confirm 'python3 --version' works on its own, then re-run this script." >&2
      exit 1
    fi
    echo "Creating $VENV_DIR ..."
    python3 -m venv "$VENV_DIR"
  fi
  PYTHON_BIN="$VENV_DIR/bin/python"
  echo "Installing/checking Python deps (this can take a while the first time, tabpfn pulls in torch)..."
  "$PYTHON_BIN" -m pip install -q -r scripts/backtest/requirements.txt || {
    echo "Full requirements install failed -- retrying without tabpfn (linear+GBM only for this run)." >&2
    "$PYTHON_BIN" -m pip install -q pandas numpy scipy scikit-learn
  }
fi

# --- 4. Run the walk-forward harness. Linear/GBM hyperparameters are
#        tuned automatically per fold by default (nested walk-forward
#        search, see harness.py) -- this genuinely takes longer than a
#        fixed-hyperparameter run, since every fold now fits several extra
#        candidate models before picking one. --no-tune skips the search
#        (fixed defaults, same speed as before tuning existed) for a
#        faster iteration run. ---
step "Running walk-forward harness (linear / GBM / TabPFN)$([ "$NO_TUNE" = "1" ] && echo ", tuning disabled" || echo ", auto-tuning hyperparameters per fold -- slower, see --no-tune")"
if [ "$NO_TUNE" = "1" ]; then
  "$PYTHON_BIN" scripts/backtest/harness.py --no-tune
else
  "$PYTHON_BIN" scripts/backtest/harness.py
fi

# --- 5. Publish this run to D1 so the live /decision-lab "Model Results"
#        tab can show it (see migrations/0007_backtest_runs.sql). Needs
#        that migration applied first -- if it isn't yet, fail with a
#        clear instruction rather than a cryptic "no such table" from D1. ---
step "Publishing results to D1 (so the live Decision Lab page can show them)"
if ! npx wrangler d1 execute "$DB_NAME" --remote --command "SELECT 1 FROM backtest_runs LIMIT 1;" >/dev/null 2>&1; then
  echo "The backtest_runs table doesn't exist in $DB_NAME yet -- run this once, then re-run this script:" >&2
  echo "  npm run db:migrate:remote" >&2
  exit 1
fi
if ! node scripts/backtest/push-to-d1.ts 2>/tmp/backtest-push-err.$$; then
  if grep -qi "strip-types\|Unknown file extension\|Unexpected token" /tmp/backtest-push-err.$$; then
    node --experimental-strip-types scripts/backtest/push-to-d1.ts
  else
    cat /tmp/backtest-push-err.$$ >&2
    rm -f /tmp/backtest-push-err.$$
    exit 1
  fi
fi
rm -f /tmp/backtest-push-err.$$
npx wrangler d1 execute "$DB_NAME" --remote --file=data/.push-backtest.sql
rm -f data/.push-backtest.sql
echo "Published -- open /decision-lab and check the \"Model Results\" tab."

echo
echo "Done. Full report: data/backtest_report.md (and data/backtest_report.json)."
