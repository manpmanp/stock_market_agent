#!/bin/bash
# Full update-and-deploy pipeline for this Worker (stock_agent).
#
# Runs everything you'd otherwise have to remember and run by hand:
# install deps, typecheck, unit tests, check whether any D1 migration is
# pending and apply it if so, a dry-run build check, the real deploy, and
# a post-deploy health check. Safe to run any time you've changed code
# and/or added a migration file -- each step only does work if there's
# actually work to do (e.g. "no pending migrations" is a normal, silent
# no-op, not an error).
#
# Usage:
#   scripts/deploy.sh                 full pipeline against remote (production) D1 + a live deploy
#   scripts/deploy.sh --local         same checks, but against local D1; stops before the live deploy
#   scripts/deploy.sh --skip-tests    skip typecheck/vitest (e.g. a docs-only change)
#   scripts/deploy.sh --recompute     after deploying, also POST /decide to refresh decision-engine
#                                     output immediately instead of waiting for the next cron
#   scripts/deploy.sh --yes           don't pause for confirmation before the live deploy step
#
# Requires ~/.cloudflare_stock_agent_token to exist for --recompute (same
# token file scripts/ingest.sh and scripts/score.sh already use). Not
# needed for the rest of the pipeline -- `wrangler deploy` and the D1
# migration commands use your `wrangler login` / CLOUDFLARE_API_TOKEN auth.
#
# If a `wrangler login` OAuth session isn't accepted for the D1 migration
# check (seen in practice as "[code: 7403] The given account is not valid
# or is not authorized", even though `wrangler whoami` shows the right
# account and a d1 scope -- an OAuth-session-vs-permission-group gap, not
# a config problem), create a Cloudflare API token instead (Account - D1 -
# Edit, Account - Workers Scripts - Edit, Account - Workers R2 Storage -
# Edit) and save it to ~/.cloudflare_stock_agent_cf_api_token (chmod 600,
# token value only, no surrounding quotes/newline issues). This script
# picks it up automatically below if CLOUDFLARE_API_TOKEN isn't already
# set in your shell -- no need to `export` it by hand each time.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

WORKER_URL="https://stock-agent.manp-dev.workers.dev"
TOKEN_FILE="$HOME/.cloudflare_stock_agent_token"
CF_API_TOKEN_FILE="$HOME/.cloudflare_stock_agent_cf_api_token"
DB_NAME="stock-agent-db"

# Load a Cloudflare API token from file rather than requiring it typed/
# exported by hand every session -- see the header comment above for when
# this is actually needed (it isn't, for a normal `wrangler login` session
# that works). A pre-existing CLOUDFLARE_API_TOKEN in the environment
# always wins, so this never silently overrides one you've deliberately
# exported yourself for this shell.
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$CF_API_TOKEN_FILE" ]; then
  export CLOUDFLARE_API_TOKEN="$(cat "$CF_API_TOKEN_FILE")"
  echo "Using Cloudflare API token from $CF_API_TOKEN_FILE"
fi

TARGET="remote"
RUN_CHECKS=1
DO_RECOMPUTE=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --local) TARGET="local" ;;
    --skip-tests) RUN_CHECKS=0 ;;
    --recompute) DO_RECOMPUTE=1 ;;
    --yes) ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,34p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (see --help)" >&2
      exit 1
      ;;
  esac
done

step() { echo; echo "== $1 =="; }

step "Installing dependencies"
npm install --no-audit --no-fund

if [ "$RUN_CHECKS" = "1" ]; then
  step "Typecheck (tsc --noEmit)"
  npm run typecheck

  step "Unit tests (vitest)"
  npm test
else
  echo
  echo "Skipping typecheck/tests (--skip-tests)"
fi

step "Checking for pending D1 migrations ($TARGET)"
MIGRATION_OUTPUT="$(npx wrangler d1 migrations list "$DB_NAME" --"$TARGET" 2>&1)" || {
  echo "$MIGRATION_OUTPUT"
  echo "Failed to check D1 migration status." >&2
  exit 1
}
echo "$MIGRATION_OUTPUT"

if echo "$MIGRATION_OUTPUT" | grep -qi "No migrations to apply"; then
  echo "No pending migrations -- nothing to apply."
else
  step "Applying pending migrations ($TARGET)"
  npx wrangler d1 migrations apply "$DB_NAME" --"$TARGET"
fi

step "Build check (wrangler deploy --dry-run)"
npx wrangler deploy --dry-run

if [ "$TARGET" = "local" ]; then
  echo
  echo "--local: checks passed, stopping before a live deploy."
  echo "Run 'npm run dev' to serve this build locally against your local D1."
  exit 0
fi

if [ "$ASSUME_YES" != "1" ]; then
  echo
  read -r -p "Dry run succeeded. Deploy to production now? [y/N] " CONFIRM
  case "$CONFIRM" in
    y|Y|yes|YES) ;;
    *)
      echo "Aborted -- nothing was deployed."
      exit 0
      ;;
  esac
fi

step "Deploying"
npx wrangler deploy

step "Verifying deploy (GET /healthz)"
HEALTH="$(curl -sS "$WORKER_URL/healthz")"
echo "$HEALTH"
if ! echo "$HEALTH" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'; then
  echo "Warning: /healthz did not return ok:true -- check the Worker manually." >&2
  exit 1
fi

if [ "$DO_RECOMPUTE" = "1" ]; then
  step "Triggering a fresh decision-engine run (POST /decide)"
  if [ ! -f "$TOKEN_FILE" ]; then
    echo "No token file at $TOKEN_FILE -- skipping recompute. Create it with:" >&2
    echo "  echo -n \"your-token\" > $TOKEN_FILE && chmod 600 $TOKEN_FILE" >&2
  else
    curl -sS -X POST "$WORKER_URL/decide" -H "Authorization: Bearer $(cat "$TOKEN_FILE")"
    echo
  fi
fi

echo
echo "Done."
echo "  $WORKER_URL/dashboard"
