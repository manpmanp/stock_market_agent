# Growth GARP research data

Same engine as `config/garp/research/` (the Defensive GARP checker), applied
to a separate growth-stock universe. Empty for now -- no growth tickers have
been researched yet.

To populate it: run the `garp-research` skill against a growth-stock
universe, writing one `<TICKER>.json` file per stock here in the same shape
as `config/garp/research/*.json` (see `src/garp/types.ts`'s `ResearchFile`).
Then run `bash scripts/garp-growth-report.sh` and commit the result -- same
flow as the defensive checker's `scripts/garp-report.sh`.

The valuation engine (`src/garp/valuation.ts`), report renderer
(`src/garp/render.ts`) and Worker route (`src/garp/serveGrowth.ts`,
`GET /garp-growth.json`) are the identical defensive-checker code, just
pointed at this folder instead of `config/garp/research/`. If growth stocks
turn out to need different valuation logic (more weight on revenue growth,
a PEG-based fair value path, less emphasis on dividend yield), that's a
deliberate follow-up to `valuation.ts` once there's real data to design and
test it against -- not guessed at here.
