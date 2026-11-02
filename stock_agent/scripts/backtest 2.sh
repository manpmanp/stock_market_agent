#!/bin/bash
# v7 backtest pipeline: exports point-in-time price history from the live
# D1 database, builds the point-in-time feature/label dataset, and runs the
# walk-forward model-comparison harness (linear / GBM / TabPFN) described on
# the /decision-lab Methodology -> Model Selection & Testing tab.
#
# Must run from your actual Mac Terminal, not through any bridged/sandboxed
# shell -- the D1 export step needs your real `wrangler login` credentials,
# which only exist there.
#
# Usage:
#   scripts/backtest.sh                 full pipeline: export -> dataset -> harness
#   scripts/backtest.sh --skip-export    reuse whatever's already in data/raw/
#                                        (fast iteration once you've exported once)
#   scripts/backtest.sh --python <path>  use a specific python3/venv interpreter
#
# First run installs Python deps (pandas/numpy/scipy/scikit-learn/tabpfn)
# into a local venv at .venv-backtest/ if one doesn't already exist. tabpfn
# pulls in torch and can take a while to download the first time -- that's
# expected. If it fails to install, the harness still runs with linear+GBM
# and says so; TabPFN just won't be part of that run's comparison.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

DB_NAME="stock-agent-db"
UNIVERSE_FILE="config/universe.json"
RAW_DIR="data/raw"
VENV_DIR=".venv-backtest"

SKIP_EXPORT=0
PYTHON_BIN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-export) SKIP_EXPORT=1; shift ;;
    --python) PYTHON_BIN="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (see --help)" >&2
      exit 1
      ;;
  esac
done

step() { echo; echo "== $1 =="; }

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
    rm -rf "$VENV_DIR"
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

# --- 4. Run the walk-forward harness. ---
step "Running walk-forward harness (linear / GBM / TabPFN)"
"$PYTHON_BIN" scripts/backtest/harness.py

echo
echo "Done. Full report: data/backtest_report.md (and data/backtest_report.json)."
