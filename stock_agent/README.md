# stock-agent (v1)

AI-assisted stock research and screening system. Ingests market data,
stores it in Cloudflare D1, and scores stocks by valuation, quality, and
momentum to produce a ranked watchlist across short/mid/long-term horizons.
Research output only, not investment advice, not a broker, does not place
trades.

This is v1: Yahoo Finance is the only data source, and the universe is a
seed list of 10 Nordic (OMX Stockholm) + 10 US large-cap tickers in
`config/universe.json`. TradingView, Investing.com, Seeking Alpha, Simply
Wall St, Morningstar, Forbes, and Lyn Alden from the original source list
are deferred to v2 (see "What's not in v1" below and the project spec
document this repo implements).

## How it fits together

```
config/universe.json  --lists tickers-->  src/ingestion/run.ts
                                                |
                                                v
                                    Yahoo Finance chart + quoteSummary
                                     (src/lib/yahoo.ts, src/lib/parse.ts)
                                                |
                                                v
                                          Cloudflare D1
                                    (migrations/0001_init.sql)
                                                |
                                                v
                                     src/scoring/run.ts
                          (indicators.ts computes RSI/MACD/SMA/vol,
                           score.ts computes composite scores)
                                                |
                                                v
                                     rankings table in D1
                                                |
                                                v
                                GET /rankings?horizon=short|mid|long
```

`src/index.ts` is the Worker entrypoint. Its `scheduled` handler (Cron
Trigger, see `wrangler.toml`) runs ingestion then scoring once a day.
`fetch` exposes `/rankings` (public, read-only) and `/ingest` + `/score`
(manual triggers, gated behind `ADMIN_TOKEN`).

## Local development

```
npm install
npx wrangler d1 create stock-agent-db      # then paste the returned id into wrangler.toml
npm run db:migrate:local
npm run dev
```

`npm run dev` runs the Worker against a local D1 (SQLite) instance. Note:
this sandbox's own network egress is restricted to package registries, so
live Yahoo Finance calls could not be tested from inside this build
session -- see "What was and wasn't tested" below. Test it for real the
first time you run `wrangler dev` or hit `/ingest` locally.

## First deploy

1. `wrangler login` (or set `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`).
2. `npx wrangler d1 create stock-agent-db`, then put the returned
   `database_id` into `wrangler.toml`.
3. `npm run db:migrate:remote`.
4. `npx wrangler secret put ADMIN_TOKEN` (pick any random string; this
   gates the manual `/ingest` and `/score` endpoints -- see
   "Securing the manual endpoints" below).
5. `npm run deploy`.
6. In the GitHub repo settings, add `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` as Actions secrets so `.github/workflows/deploy.yml`
   can deploy on push to `main`.

After that, the Cron Trigger in `wrangler.toml` runs ingestion + scoring
once a day automatically; no further manual steps are needed.

## Securing the manual endpoints

`/ingest` and `/score` are POST-only and require
`Authorization: Bearer <ADMIN_TOKEN>`. Without that secret set, they
refuse every request (closed by default, not open). The scheduled cron
job bypasses this since Cloudflare invokes it directly, not over HTTP.
`/rankings` and `/healthz` are intentionally public and read-only.

## Free tier limits

Cloudflare's free plan currently allows roughly 5M D1 row reads/day, 100k
D1 row writes/day, 100k Worker requests/day, and 10GB of R2 storage (not
used yet in v1). A 20-ticker universe, ingested once daily, uses a small
fraction of this. Re-check the actual numbers against Cloudflare's current
published limits before increasing ingestion frequency or the universe
size by an order of magnitude -- free-tier limits change and this repo
doesn't enforce them for you.

## What's in v1

- Seed universe: 10 Nordic (Avanza/OMX Stockholm) + 10 US large-cap tickers,
  configurable in `config/universe.json`.
- Single source: Yahoo Finance's unofficial chart + quoteSummary endpoints
  (price history, core fundamentals, analyst target price/rating).
- D1 schema for stocks, price history, fundamentals, valuation estimates,
  technicals, rankings, and a source_log for auditability
  (`migrations/0001_init.sql`).
- Technical indicators computed from stored price history: RSI(14), MACD,
  SMA 50/100/200, 30-day annualized volatility, 20d/90d volume trend.
- A documented, adjustable composite scoring formula
  (`src/scoring/score.ts`) blending valuation, quality, and momentum
  sub-scores with different weights per horizon.
- A daily Cron Trigger plus a JSON API (`/rankings`).
- 17 unit tests against fixture data (no live network needed to run them).

## What's not in v1 (by design, deferred to v2)

- The other six sources (TradingView, Investing.com, Seeking Alpha, Simply
  Wall St, Morningstar, Forbes, Lyn Alden). Yahoo alone is enough to prove
  the pipeline end to end; adding sources multiplies scraping/ToS risk and
  parsing surface, so it's deliberately sequenced after v1 works.
- Cross-sectional scoring only -- see the comment at the top of
  `src/scoring/score.ts`. Scores rank stocks against today's universe
  snapshot, not against sector or multi-year history. That's a real
  limitation, not a placeholder; multi-source, multi-day data is what
  would fix it.
- Backtesting. The scoring weights in `HORIZON_WEIGHTS`
  (`src/scoring/score.ts`) are a documented starting point, not validated
  against historical outcomes yet. Treat rankings as a research starting
  point, not a conclusion, until that's done.
- Portfolio awareness (no knowledge of what you already hold on Avanza).
- ISIN and return-on-invested-capital are always null in v1 -- Yahoo's
  free modules don't expose them; both are flagged, not silently guessed.

## What was and wasn't tested in this build session

This sandbox's shell can reach GitHub and the npm/pip package registries,
but not finance.yahoo.com or general internet hosts -- that's an
intentional egress allowlist on this environment, not a bug in the code.
So this session verified: the TypeScript compiles clean (`npm run
typecheck`), and 17 unit tests pass against realistic fixture data
covering parsing, indicator math, and the scoring/ranking logic
(`npm test`). It could not verify: a live call to Yahoo's endpoints
(including whether the crumb/cookie handshake in `src/lib/yahoo.ts`
still matches Yahoo's current behavior -- this is the single highest-risk
piece of v1 and the first thing to check against a real `wrangler dev`
run), an actual `wrangler deploy`, or D1 behavior against real Cloudflare
infrastructure. Treat the first real `/ingest` run as the actual
integration test.

## Next steps (suggested order)

1. Push this repo to GitHub, run `wrangler dev` locally, and confirm a real
   `POST /ingest` call actually pulls and stores data for a couple of
   tickers -- this validates the one part that couldn't be tested here.
2. Deploy, let the daily cron run for a week or two, and eyeball
   `source_log` for recurring errors per ticker/source.
3. Backtest `HORIZON_WEIGHTS` in `src/scoring/score.ts` against the
   accumulating `price_history`/`rankings` data before trusting the
   rankings (open question carried over from the project spec).
4. Add the next data source (Investing.com or Simply Wall St are the more
   scrape-friendly of the remaining six) once v1's pipeline shape has
   proven itself.
