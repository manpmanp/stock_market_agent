// Second, independent dashboard page for the 10-factor decision engine
// (src/decision/*), served at GET /decision-lab. Deliberately a separate
// route/page from GET /dashboard (src/dashboard.ts), which stays exactly
// as it was -- per the explicit instruction to keep the two systems
// comparable side by side rather than merging or replacing either. Shares
// the same color-system tokens as dashboard.ts (same validated palette)
// purely for visual family, not code -- no imports between the two pages.
export function renderDecisionLab(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Decision Lab</title>
<style>
  :root {
    color-scheme: light;
    --surface-1:      #fcfcfb;
    --page:           #f9f9f7;
    --text-primary:   #0b0b0b;
    --text-secondary: #52514e;
    --text-muted:     #898781;
    --gridline:       #e1e0d9;
    --border:         rgba(11,11,11,0.10);
    --seq-400:        #3987e5;
    --seq-250:        #86b6ef;
    --seq-100:        #cde2fb;
    --status-good:    #0ca30c;
    --status-bad:     #eb6834;
    --status-warn:    #c98a1c;
    --unscored:       #b08a2e;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --surface-1:      #1a1a19;
      --page:           #0d0d0d;
      --text-primary:   #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted:     #898781;
      --gridline:       #2c2c2a;
      --border:         rgba(255,255,255,0.10);
      --seq-400:        #3987e5;
      --seq-250:        #2a78d6;
      --seq-100:        #184f95;
      --status-good:    #0ca30c;
      --status-bad:     #d95926;
      --status-warn:    #d9a23a;
      --unscored:       #d9a23a;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--text-primary); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 24px 16px 64px; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--text-secondary); font-size: 13px; margin: 0 0 4px; max-width: 640px; }
  .note { color: var(--text-muted); font-size: 12px; margin: 0 0 28px; max-width: 640px; }
  section { margin-bottom: 36px; }
  h2 { font-size: 15px; margin: 0 0 12px; }
  .tabs { display: flex; gap: 6px; margin-bottom: 16px; }
  .tab { font-size: 13px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-1); color: var(--text-secondary); cursor: pointer; }
  .tab[aria-selected="true"] { color: var(--text-primary); border-color: var(--seq-400); font-weight: 600; }
  .run-at { font-size: 12px; color: var(--text-muted); margin-bottom: 14px; }
  .card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; cursor: pointer; }
  .card-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
  .t { font-weight: 700; font-size: 14px; }
  .decision-badge { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; color: #fff; white-space: nowrap; }
  .decision-badge.strong-buy, .decision-badge.buy { background: var(--status-good); }
  .decision-badge.accumulate { background: var(--seq-400); }
  .decision-badge.hold-wait { background: var(--text-muted); }
  .decision-badge.reduce, .decision-badge.sell, .decision-badge.strong-sell { background: var(--status-bad); }
  .meta-row { display: flex; gap: 14px; font-size: 12px; color: var(--text-secondary); margin-top: 6px; flex-wrap: wrap; }
  .meta-row b { color: var(--text-primary); }
  .factors { display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
  .card[aria-expanded="true"] .factors { display: block; }
  .factor-row { display: grid; grid-template-columns: 140px 1fr 40px; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 12px; }
  .factor-row .fname { color: var(--text-secondary); display: flex; align-items: center; gap: 4px; }
  .factor-row .unscored-flag { color: var(--unscored); font-size: 10px; border: 1px solid var(--unscored); border-radius: 4px; padding: 0 4px; }
  .bar-track { height: 6px; border-radius: 3px; background: var(--gridline); overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 3px; background: var(--seq-400); }
  .factor-row .fval { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-muted); }
  .warnings { margin-top: 10px; font-size: 12px; color: var(--status-warn); }
  .warnings div { margin-bottom: 2px; }
  .supporting { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
  .supporting h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-muted); margin: 0 0 8px; font-weight: 600; }
  .metric-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px 14px; margin-bottom: 10px; }
  .metric-tile { }
  .metric-tile .mlabel { font-size: 10px; color: var(--text-muted); display: flex; align-items: center; gap: 3px; }
  .metric-tile .mval { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .metric-tile.highlight .mval { color: var(--seq-400); }
  .rec-bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; margin: 4px 0 4px; background: var(--gridline); }
  .rec-bar span { height: 100%; }
  .rec-bar .rsb { background: var(--status-good); }
  .rec-bar .rb { background: #6fae3f; }
  .rec-bar .rh { background: var(--text-muted); }
  .rec-bar .rs { background: #d9873a; }
  .rec-bar .rss { background: var(--status-bad); }
  .rec-legend { display: flex; gap: 10px; flex-wrap: wrap; font-size: 10px; color: var(--text-muted); margin-bottom: 10px; }
  .rec-legend span { display: inline-flex; align-items: center; gap: 3px; }
  .rec-legend i { width: 7px; height: 7px; border-radius: 2px; display: inline-block; }
  .target-range { font-size: 11px; color: var(--text-secondary); }
  .target-range b { color: var(--text-primary); }
  .empty { color: var(--text-muted); font-size: 13px; padding: 12px; }
  .weights-panel { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .weight-row { display: grid; grid-template-columns: 150px 1fr 52px; align-items: center; gap: 10px; margin-bottom: 10px; }
  .weight-row label { font-size: 13px; color: var(--text-secondary); }
  .weight-row input[type="range"] { width: 100%; }
  .weight-row .wval { font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
  .method-panel { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; overflow: hidden; }
  .method-panel summary { list-style: none; cursor: pointer; padding: 12px 14px; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .method-panel summary::-webkit-details-marker { display: none; }
  .method-panel summary .chevron { font-size: 11px; color: var(--text-muted); transition: transform .15s ease; }
  .method-panel[open] summary .chevron { transform: rotate(180deg); }
  .method-body { padding: 0 14px 16px; font-size: 13px; color: var(--text-secondary); }
  .method-body h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-muted); margin: 16px 0 8px; }
  .method-body h3:first-child { margin-top: 4px; }
  .method-body p { margin: 0 0 8px; }
  .method-body ul { margin: 0 0 8px; padding-left: 18px; }
  .method-body li { margin-bottom: 4px; }
  .method-body table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 6px 0 10px; }
  .method-body th, .method-body td { text-align: left; padding: 4px 8px 4px 0; border-bottom: 1px solid var(--border); }
  .method-body th { color: var(--text-muted); font-weight: 600; }
  .method-body code { background: var(--gridline); border-radius: 4px; padding: 1px 5px; font-size: 12px; }
  .glossary { margin: 4px 0 10px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--page); }
  .glossary summary { padding: 8px 12px; font-size: 12px; font-weight: 600; color: var(--text-primary); cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .glossary summary::-webkit-details-marker { display: none; }
  .glossary summary .chevron { font-size: 10px; color: var(--text-muted); transition: transform .15s ease; }
  .glossary[open] summary .chevron { transform: rotate(180deg); }
  .glossary-body { padding: 2px 12px 10px; }
  .term-row { padding: 7px 0; border-top: 1px solid var(--border); }
  .term-row:first-child { border-top: none; }
  .term-name { font-weight: 600; font-size: 12px; color: var(--text-primary); }
  .term-name .term-full { font-weight: 400; font-size: 11px; color: var(--text-muted); margin-left: 5px; }
  .term-def { font-size: 12px; color: var(--text-secondary); margin-top: 3px; }
  .weight-sum { font-size: 13px; margin: 10px 0 14px; }
  .weight-sum.ok { color: var(--status-good); }
  .weight-sum.bad { color: var(--status-bad); }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; }
  button { font: inherit; font-size: 13px; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-1); color: var(--text-primary); cursor: pointer; }
  button.primary { background: var(--seq-400); border-color: var(--seq-400); color: #fff; font-weight: 600; }
  button:disabled { opacity: 0.5; cursor: default; }
  .status-msg { font-size: 12px; margin-top: 10px; }
  .status-msg.ok { color: var(--status-good); }
  .status-msg.bad { color: var(--status-bad); }
  a.back { font-size: 12px; color: var(--text-secondary); }
</style>
</head>
<body>
<main>
  <p><a class="back" href="/dashboard">&larr; back to the main watchlist</a></p>
  <h1>Decision Lab</h1>
  <p class="sub">A second, independent 10-factor decision engine (quality, growth, financial strength, valuation, future potential, technical, entry, risk, catalyst, market regime), run alongside the main watchlist for comparison. Weights are stored in the database and can be tuned below without redeploying.</p>
  <p class="note">Catalyst has no news/events data source wired in yet, so it's currently a flagged neutral placeholder -- a future version could add one (see "How the algorithm works" below). Market regime is a real (if simple) live computation from a broad market-index proxy, not this ticker's own data. Data-driven research output, not investment advice.</p>

  <section>
    <details class="method-panel">
      <summary>How the algorithm works <span class="chevron">&#9662;</span></summary>
      <div class="method-body">
        <h3>The 10 factors</h3>
        <p>Every ticker gets a 0-100 score on each of 10 factors, each meant to answer a different question:</p>
        <table>
          <tr><th>Factor</th><th>What feeds it</th></tr>
          <tr><td>Quality</td><td>Gross margin, operating margin, net margin, return on equity (ROE), return on assets (ROA) -- is this a good business</td></tr>
          <tr><td>Growth</td><td>Revenue growth (YoY), earnings growth (YoY)</td></tr>
          <tr><td>Financial strength</td><td>Debt-to-equity, free cash flow (FCF) yield, Net Debt/EBITDA, interest coverage -- can it weather a downturn</td></tr>
          <tr><td>Valuation</td><td>Where price sits in its own ~5y range, the gap vs. analyst fair value, plus EV/EBIT as an absolute cross-check against those two self-relative reads</td></tr>
          <tr><td>Future potential</td><td>A proxy (PEG ratio + analyst coverage count) for growth-adjusted upside -- not a real TAM/runway estimate, no data source for that exists</td></tr>
          <tr><td>Technical</td><td>RSI (14-day), MACD vs. its signal line, price vs. 50-day average, price vs. 200-day average -- see the glossary below for what each one means and how to read the numbers</td></tr>
          <tr><td>Entry</td><td>This ticker's own trend-state read (pullback in an uptrend / near highs / downtrend / neutral) plus RSI -- is right now, specifically, a reasonable point to buy</td></tr>
          <tr><td>Risk</td><td>30-day volatility, debt-to-equity, distance from this ticker's own high, Beta -- higher score = lower risk</td></tr>
          <tr><td>Catalyst</td><td>Currently a flagged neutral placeholder (50) in this version -- no news/events data source is wired in yet (see note below the table)</td></tr>
          <tr><td>Market regime</td><td>One shared reading per run, from a market-index proxy's (SPY) own trend -- not this ticker's own data, so it moves every ticker together, not against each other</td></tr>
        </table>
        <p class="note">P/E, EV/EBITDA, payout ratio, and the analyst recommendation/price-target spread are shown on each card as supporting metrics but aren't blended into any factor score -- see "Valuation & balance-sheet multiples" and "Analyst cross-check" on the decision cards below.</p>
        <details class="glossary">
          <summary>Glossary: what each technical/financial term means, and how to read the number <span class="chevron">&#9662;</span></summary>
          <div class="glossary-body">
            <div class="term-row">
              <div class="term-name">RSI <span class="term-full">Relative Strength Index (14-day)</span></div>
              <div class="term-def">Momentum oscillator from 0-100, based on the size of recent up-moves vs. down-moves. Textbook reading: above 70 is "overbought," below 30 is "oversold." This engine's Technical factor doesn't use that reading directly -- it scores <i>highest</i> at RSI 50 (neutral) and lower the further RSI drifts toward either extreme, treating a big swing either way as reduced momentum-signal confidence rather than a buy/sell trigger on its own.</div>
            </div>
            <div class="term-row">
              <div class="term-name">MACD <span class="term-full">Moving Average Convergence Divergence (and its signal line)</span></div>
              <div class="term-def">Tracks the relationship between a stock's short-term and long-term price trend; the signal line is a moving average of the MACD line itself. Here it's read as a binary trend direction: MACD above its signal line scores as bullish, at-or-below scores as bearish -- not the raw magnitude of the gap.</div>
            </div>
            <div class="term-row">
              <div class="term-name">SMA50 / SMA200, "price vs. SMA" <span class="term-full">Simple Moving Average (50-day / 200-day)</span></div>
              <div class="term-def">The average closing price over that window -- a smoothed read of the trend, less noisy than the raw price. "Price vs. SMA50/200" is the % gap between today's price and that average: positive means trading above its own trend, negative means below. This engine treats roughly &plusmn;10% around the 50-day average and &plusmn;15% around the 200-day average as its "meaningfully above/below trend" band.</div>
            </div>
            <div class="term-row">
              <div class="term-name">Volatility (30-day)</div>
              <div class="term-def">The standard deviation of daily returns over the last 30 trading days, annualized. Measures how much the price has been swinging, regardless of direction. Higher = more turbulent, scores as more risk here; lower = calmer, scores as less risk.</div>
            </div>
            <div class="term-row">
              <div class="term-name">PEG ratio <span class="term-full">Price/Earnings-to-Growth ratio</span></div>
              <div class="term-def">P/E divided by the expected earnings growth rate -- a growth-adjusted valuation multiple. Roughly, under ~1 is historically considered potentially cheap relative to growth, over ~2-3 potentially expensive. Feeds the Future Potential proxy here, not the Valuation factor itself.</div>
            </div>
            <div class="term-row">
              <div class="term-name">ROE <span class="term-full">Return on Equity</span></div>
              <div class="term-def">Net income divided by shareholder equity -- how efficiently the company turns shareholders' capital into profit. Higher is generally better; this engine treats roughly 8% as the low end of "decent" and 30%+ as excellent for scoring purposes.</div>
            </div>
            <div class="term-row">
              <div class="term-name">Debt-to-equity <span class="term-full">D/E ratio</span></div>
              <div class="term-def">Total debt divided by shareholder equity -- how leveraged the company is. Lower is generally safer. Used in both Financial Strength and Risk here, since heavy leverage cuts both ways: less resilient, and riskier.</div>
            </div>
            <div class="term-row">
              <div class="term-name">FCF yield <span class="term-full">Free Cash Flow Yield</span></div>
              <div class="term-def">Free cash flow divided by market cap -- how much real cash the business throws off relative to what you're paying for it. Higher is generally better.</div>
            </div>
            <div class="term-row">
              <div class="term-name">Distance from high</div>
              <div class="term-def">How far the current price sits below its own highest close in the lookback window, as a percentage -- a drawdown read specific to this ticker's own history. 0% = at its own high; more negative = a deeper pullback. Used in the Risk factor (a very deep drawdown reads as elevated risk), separate from the Entry factor's read on whether a pullback looks like a buying opportunity.</div>
            </div>
            <div class="term-row">
              <div class="term-name">EV/EBIT <span class="term-full">Enterprise Value / Earnings Before Interest and Taxes</span></div>
              <div class="term-def">Enterprise value (market cap + debt &minus; cash -- what it would cost to buy the whole company, debt included) divided by EBIT (operating profit, before interest and tax). Unlike P/E, it isn't distorted by capital structure (how much debt a company carries) or tax rate, so it's a cleaner apples-to-apples multiple across companies -- this engine treats roughly 8x as cheap and 30x+ as expensive. Feeds the Valuation factor as a third signal alongside the two self-relative reads (own price range, gap vs. analyst fair value), and is also shown raw next to P/E on each card.</div>
            </div>
            <div class="term-row">
              <div class="term-name">EV/EBITDA <span class="term-full">Enterprise Value / EBITDA</span></div>
              <div class="term-def">Same idea as EV/EBIT, but against EBITDA (operating profit before interest, tax, depreciation, and amortization) instead of EBIT -- so it also strips out the effect of how much a company depreciates its assets. Already pulled from Yahoo Finance directly (not derived here). Shown as a supporting metric next to EV/EBIT for comparison; not separately scored, since EV/EBIT is the one feeding the Valuation factor.</div>
            </div>
            <div class="term-row">
              <div class="term-name">Net Debt/EBITDA</div>
              <div class="term-def">(Total debt &minus; total cash) divided by EBITDA -- how many years of current cash-flow generation it would take to pay off all debt, net of cash on hand. Lower is safer; it can go negative (a "net cash" position, meaning cash on hand exceeds debt), which reads as very strong here. This engine treats ~0x or negative as strong and ~4x+ as stretched. Feeds Financial Strength alongside debt-to-equity and FCF yield.</div>
            </div>
            <div class="term-row">
              <div class="term-name">Interest coverage <span class="term-full">EBIT / Interest expense</span></div>
              <div class="term-def">How many times over a company's operating profit could cover its interest payments -- a direct read on debt-servicing safety, distinct from leverage ratios (which measure how much debt exists, not whether it's being paid comfortably). Below ~2x is a red flag, above ~8x is comfortable. Feeds Financial Strength.</div>
            </div>
            <div class="term-row">
              <div class="term-name">Beta</div>
              <div class="term-def">How much a stock has tended to move relative to the broader market: 1.0 means it moves roughly in line with the market, above 1.0 means historically more volatile than the market (bigger swings both up and down), below 1.0 means historically calmer than the market. Distinct from this ticker's own (absolute) 30-day volatility -- a stock can be internally calm but still carry a high beta if its calm periods and volatile periods both track the market's. Feeds the Risk factor; this engine treats ~0.5 as low-risk and ~2.0+ as high-risk.</div>
            </div>
            <div class="term-row">
              <div class="term-name">ROA <span class="term-full">Return on Assets</span></div>
              <div class="term-def">Net income divided by total assets -- how efficiently the company turns everything it owns (debt-funded or not) into profit. Complements ROE, which only measures profit against shareholder equity and so can be inflated by leverage (a highly-indebted company can post a high ROE on a thin equity base) -- ROA can't be inflated that way. Higher is better; this engine treats ~3% as the low end of "decent" and ~15%+ as excellent. Feeds Quality alongside the margin and ROE reads.</div>
            </div>
            <div class="term-row">
              <div class="term-name">Payout ratio</div>
              <div class="term-def">The share of earnings paid out as dividends (dividends / net income). Not scored into any factor here -- a high payout ratio isn't automatically a bad sign (mature, stable-cash-flow businesses often run high payout ratios by design), so it doesn't map cleanly onto a single "higher/lower is better" band the way a leverage ratio does. Shown as a supporting metric on each card for the reader to weigh in context, e.g. alongside FCF yield and Net Debt/EBITDA.</div>
            </div>
            <div class="term-row">
              <div class="term-name">Analyst recommendations &amp; price targets</div>
              <div class="term-def">The current breakdown of sell-side analyst ratings (strong buy / buy / hold / sell / strong sell) and their low/mean/high 12-month price targets, both from Yahoo Finance. Shown as a cross-check on each card, never blended into the weighted score -- it's other analysts' independent view, useful for sanity-checking this engine's read, not an input to it.</div>
            </div>
          </div>
        </details>
        <h3>How a score becomes a decision</h3>
        <p>Each horizon (Short / Medium / Long) has its own weight vector -- see "Weight tuning" below. The final score is a straight weighted average: each factor's 0-100 value &times; its weight for that horizon, summed. That score maps to a label through fixed bands: <code>&ge;85 STRONG BUY</code>, <code>&ge;75 BUY</code>, <code>&ge;65 ACCUMULATE</code>, <code>&ge;50 HOLD/WAIT</code>, <code>&ge;40 REDUCE</code>, <code>&ge;25 SELL</code>, below that <code>STRONG SELL</code>.</p>
        <p><b>Confidence is not another weighted average.</b> It's 100 minus the spread (standard deviation) across the 10 raw factor scores. If quality, growth, valuation, technical, etc. all broadly agree -- all high or all low -- confidence is high. If they disagree (say, elite quality but terrible technicals), confidence drops, regardless of what the final score comes out to. High dispersion means the evidence is mixed, not that the stock is secretly bullish or bearish.</p>
        <p>Valuation status (e.g. <code>UNDERVALUED</code>) and entry status (e.g. <code>GOOD_ENTRY</code>) shown on each card are separate raw classifications -- not blended into the score -- so you can see the underlying read even when it's outweighed by other factors.</p>
      </div>
    </details>
    <details class="method-panel">
      <summary>How weight tuning works <span class="chevron">&#9662;</span></summary>
      <div class="method-body">
        <p>The weights below are ported starting hypotheses, not backtested or calibrated values -- treat every change as an experiment, not a correction.</p>
        <h3>Recommended process</h3>
        <ul>
          <li>Change one factor at a time, by a small amount (2-5 percentage points), rather than rebalancing the whole vector at once -- it's much easier to tell what a change actually did.</li>
          <li>Tune each horizon separately. Short, medium, and long are deliberately meant to weigh things differently (e.g. short leans on entry/technical, long leans on quality/growth) -- there's no reason to expect one good vector for all three.</li>
          <li>Watch the effect across a few runs/days before trusting it. One day's numbers reflect one day's prices, not a pattern.</li>
          <li>Avoid pushing weight onto <code>catalyst</code> for now -- until a news/events data source is wired in, it's a fixed neutral placeholder and can't differentiate one ticker from another, so a higher weight there just dilutes the factors that do carry signal.</li>
          <li>Use the note field when saving to record why you changed something. Every save is kept as history (not overwritten), so it doubles as a decision log you can look back on.</li>
          <li>Weights for a horizon must sum to 1.0 -- the Save button is disabled until they do.</li>
        </ul>
        <h3>What "Recompute decisions now" does</h3>
        <p>Saving weights alone doesn't change anything you're looking at -- it only updates what the <i>next</i> run will use. Recompute triggers that run immediately (against an admin token) so you can see the new weights' effect right away, instead of waiting for the next hourly/daily cron.</p>
      </div>
    </details>
  </section>

  <section>
    <h2>Decisions</h2>
    <div class="tabs" id="horizon-tabs" role="tablist"></div>
    <div class="run-at" id="run-at"></div>
    <div id="decisions-list"></div>
  </section>

  <section>
    <h2>Weight tuning</h2>
    <div class="weights-panel">
      <div class="tabs" id="weight-tabs" role="tablist"></div>
      <div id="weight-sliders"></div>
      <div class="weight-sum" id="weight-sum"></div>
      <div class="actions">
        <button id="reset-btn">Reset to last saved</button>
        <button class="primary" id="save-btn">Save weights</button>
        <button id="recompute-btn">Recompute decisions now</button>
      </div>
      <div class="status-msg" id="status-msg"></div>
    </div>
  </section>
</main>

<script>
(function () {
  var FACTORS = ["quality","growth","financial_strength","valuation","future_potential","technical","entry","risk","catalyst","market_regime"];
  var FACTOR_LABELS = {
    quality: "Quality", growth: "Growth", financial_strength: "Financial strength",
    valuation: "Valuation", future_potential: "Future potential", technical: "Technical",
    entry: "Entry", risk: "Risk", catalyst: "Catalyst", market_regime: "Market regime"
  };
  var HORIZONS = ["short", "medium", "long"];
  var currentHorizon = "long";
  var currentWeightHorizon = "long";
  var savedWeights = {};   // last-known-saved, per horizon, for Reset
  var draftWeights = {};   // in-progress slider edits, per horizon

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (children || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function decisionClass(label) {
    return String(label || "").toLowerCase().replace(/\\s+\\/\\s+/g, "-").replace(/\\s+/g, "-");
  }
  function fmt(n, d) {
    if (n === null || n === undefined) return "–";
    return Number(n).toFixed(d === undefined ? 1 : d);
  }
  function fmtX(n) {
    if (n === null || n === undefined) return "–";
    return Number(n).toFixed(1) + "x";
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return "–";
    return (Number(n) * 100).toFixed(1) + "%";
  }

  // --- Decisions list ---

  function renderHorizonTabs() {
    var wrap = document.getElementById("horizon-tabs");
    wrap.innerHTML = "";
    HORIZONS.forEach(function (h) {
      var tab = el("button", { class: "tab", role: "tab", "aria-selected": h === currentHorizon ? "true" : "false", text: h.charAt(0).toUpperCase() + h.slice(1) });
      tab.addEventListener("click", function () { currentHorizon = h; renderHorizonTabs(); loadDecisions(); });
      wrap.appendChild(tab);
    });
  }

  function factorRow(factor, scores, contribution) {
    var value = scores && scores[factor] !== undefined ? scores[factor] : null;
    var row = el("div", { class: "factor-row" });
    var name = el("div", { class: "fname" }, [document.createTextNode(FACTOR_LABELS[factor] || factor)]);
    row.appendChild(name);
    var track = el("div", { class: "bar-track" }, [el("div", { class: "bar-fill", style: "width:" + Math.max(0, Math.min(100, value || 0)) + "%" })]);
    row.appendChild(track);
    row.appendChild(el("div", { class: "fval", text: value === null ? "–" : fmt(value, 0) }));
    return row;
  }

  function metricTile(label, value, highlight) {
    var tile = el("div", { class: "metric-tile" + (highlight ? " highlight" : "") });
    tile.appendChild(el("div", { class: "mlabel", text: label }));
    tile.appendChild(el("div", { class: "mval", text: value }));
    return tile;
  }

  // EV/EBIT, Net Debt/EBITDA, interest coverage, Beta, ROA, and the
  // analyst recommendation/target-price spread -- the raw numbers behind
  // some of the factor scores above, shown directly rather than only as
  // an abstracted 0-100 score. Analyst data is a cross-check, never
  // blended into the weighted score.
  function renderSupportingMetrics(d) {
    var m = null;
    try { m = JSON.parse(d.supporting_metrics_json || "null"); } catch (e) {}
    if (!m) return null;

    var wrap = el("div", { class: "supporting" });

    wrap.appendChild(el("h4", { text: "Valuation & balance-sheet multiples" }));
    var grid = el("div", { class: "metric-grid" });
    grid.appendChild(metricTile("P/E", fmtX(m.trailingPe)));
    grid.appendChild(metricTile("EV/EBITDA", fmtX(m.evToEbitda)));
    grid.appendChild(metricTile("EV/EBIT", fmtX(m.evToEbit), true));
    grid.appendChild(metricTile("Net Debt/EBITDA", fmtX(m.netDebtToEbitda)));
    grid.appendChild(metricTile("Interest coverage", fmtX(m.interestCoverage)));
    grid.appendChild(metricTile("Beta", fmt(m.beta, 2)));
    grid.appendChild(metricTile("ROA", fmtPct(m.returnOnAssets)));
    grid.appendChild(metricTile("Payout ratio", fmtPct(m.payoutRatio)));
    wrap.appendChild(grid);

    var a = m.analyst || {};
    var recTotal = (a.recStrongBuy || 0) + (a.recBuy || 0) + (a.recHold || 0) + (a.recSell || 0) + (a.recStrongSell || 0);
    if (recTotal > 0 || a.targetLow !== null) {
      wrap.appendChild(el("h4", { text: "Analyst cross-check (not part of the score)" }));
    }
    if (recTotal > 0) {
      var bar = el("div", { class: "rec-bar" });
      [["rsb", a.recStrongBuy], ["rb", a.recBuy], ["rh", a.recHold], ["rs", a.recSell], ["rss", a.recStrongSell]].forEach(function (pair) {
        var count = pair[1] || 0;
        if (count <= 0) return;
        bar.appendChild(el("span", { class: pair[0], style: "width:" + ((count / recTotal) * 100) + "%" }));
      });
      wrap.appendChild(bar);
      wrap.appendChild(el("div", { class: "rec-legend" }, [
        el("span", {}, [el("i", { style: "background:var(--status-good)" }), document.createTextNode("Strong buy " + (a.recStrongBuy || 0))]),
        el("span", {}, [el("i", { style: "background:#6fae3f" }), document.createTextNode("Buy " + (a.recBuy || 0))]),
        el("span", {}, [el("i", { style: "background:var(--text-muted)" }), document.createTextNode("Hold " + (a.recHold || 0))]),
        el("span", {}, [el("i", { style: "background:#d9873a" }), document.createTextNode("Sell " + (a.recSell || 0))]),
        el("span", {}, [el("i", { style: "background:var(--status-bad)" }), document.createTextNode("Strong sell " + (a.recStrongSell || 0))]),
      ]));
    }
    if (a.targetLow !== null && a.targetLow !== undefined) {
      wrap.appendChild(el("div", { class: "target-range" }, [
        document.createTextNode("Price target: " + fmt(a.targetLow, 2) + " – "),
        el("b", { text: fmt(a.targetMean, 2) }),
        document.createTextNode(" – " + fmt(a.targetHigh, 2) + (m.currentPrice !== null ? "  (current: " + fmt(m.currentPrice, 2) + ")" : "") + (a.numAnalysts ? "  · " + a.numAnalysts + " analysts" : "")),
      ]));
    }
    return wrap;
  }

  function renderDecisionCard(d) {
    var scores = {}, contribution = {}, warnings = [];
    try { scores = JSON.parse(d.factor_scores_json || "{}"); } catch (e) {}
    try { contribution = JSON.parse(d.factor_contribution_json || "{}"); } catch (e) {}
    try { warnings = JSON.parse(d.warnings_json || "[]"); } catch (e) {}

    var card = el("div", { class: "card", "aria-expanded": "false" });
    var head = el("div", { class: "card-head" }, [
      el("div", { class: "t", text: d.ticker }),
      el("div", { class: "decision-badge " + decisionClass(d.decision), text: d.decision || "–" }),
    ]);
    card.appendChild(head);
    card.appendChild(el("div", { class: "meta-row" }, [
      el("span", {}, [document.createTextNode("Score: "), el("b", { text: fmt(d.score) })]),
      el("span", {}, [document.createTextNode("Confidence: "), el("b", { text: fmt(d.confidence) })]),
      el("span", {}, [document.createTextNode("Valuation: "), el("b", { text: d.valuation_status || "–" })]),
      el("span", {}, [document.createTextNode("Entry: "), el("b", { text: d.entry_status || "–" })]),
    ]));

    var factors = el("div", { class: "factors" });
    FACTORS.forEach(function (f) { factors.appendChild(factorRow(f, scores, contribution)); });
    var supporting = renderSupportingMetrics(d);
    if (supporting) factors.appendChild(supporting);
    if (warnings.length) {
      var w = el("div", { class: "warnings" });
      warnings.forEach(function (msg) { w.appendChild(el("div", { text: "⚠ " + msg })); });
      factors.appendChild(w);
    }
    card.appendChild(factors);

    card.addEventListener("click", function () {
      card.setAttribute("aria-expanded", card.getAttribute("aria-expanded") === "true" ? "false" : "true");
    });
    return card;
  }

  function loadDecisions() {
    var list = document.getElementById("decisions-list");
    list.innerHTML = '<div class="empty">Loading…</div>';
    fetch("/decisions?horizon=" + encodeURIComponent(currentHorizon))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        document.getElementById("run-at").textContent = data.runAt ? ("Last run (UTC): " + data.runAt) : "No decision run yet -- use \\"Recompute decisions now\\" below.";
        list.innerHTML = "";
        if (!data.decisions || !data.decisions.length) {
          list.appendChild(el("div", { class: "empty", text: "No decisions yet for this horizon." }));
          return;
        }
        data.decisions.forEach(function (d) { list.appendChild(renderDecisionCard(d)); });
      })
      .catch(function () { list.innerHTML = '<div class="empty">Failed to load decisions.</div>'; });
  }

  // --- Weight tuning ---

  function renderWeightTabs() {
    var wrap = document.getElementById("weight-tabs");
    wrap.innerHTML = "";
    HORIZONS.forEach(function (h) {
      var tab = el("button", { class: "tab", role: "tab", "aria-selected": h === currentWeightHorizon ? "true" : "false", text: h.charAt(0).toUpperCase() + h.slice(1) });
      tab.addEventListener("click", function () { currentWeightHorizon = h; renderWeightTabs(); renderSliders(); });
      wrap.appendChild(tab);
    });
  }

  function currentSum() {
    var w = draftWeights[currentWeightHorizon] || {};
    return FACTORS.reduce(function (a, f) { return a + (w[f] || 0); }, 0);
  }

  function updateSum() {
    var sum = currentSum();
    var elSum = document.getElementById("weight-sum");
    var ok = Math.abs(sum - 1) < 0.005;
    elSum.textContent = "Sum: " + sum.toFixed(3) + (ok ? " (OK, sums to 1.0)" : " (must sum to 1.0 to save)");
    elSum.className = "weight-sum " + (ok ? "ok" : "bad");
    document.getElementById("save-btn").disabled = !ok;
  }

  function renderSliders() {
    var wrap = document.getElementById("weight-sliders");
    wrap.innerHTML = "";
    var w = draftWeights[currentWeightHorizon] || {};
    FACTORS.forEach(function (f) {
      var val = w[f] === undefined ? 0 : w[f];
      var row = el("div", { class: "weight-row" });
      row.appendChild(el("label", { text: FACTOR_LABELS[f] }));
      var input = el("input", { type: "range", min: "0", max: "0.5", step: "0.01", value: String(val) });
      var out = el("div", { class: "wval", text: val.toFixed(2) });
      input.addEventListener("input", function () {
        draftWeights[currentWeightHorizon][f] = parseFloat(input.value);
        out.textContent = parseFloat(input.value).toFixed(2);
        updateSum();
      });
      row.appendChild(input);
      row.appendChild(out);
      wrap.appendChild(row);
    });
    updateSum();
  }

  function loadWeights() {
    fetch("/weights")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var weights = data.weights || {};
        HORIZONS.forEach(function (h) {
          savedWeights[h] = weights[h] || {};
          draftWeights[h] = Object.assign({}, weights[h] || {});
        });
        renderWeightTabs();
        renderSliders();
      })
      .catch(function () {
        document.getElementById("status-msg").textContent = "Failed to load weights.";
        document.getElementById("status-msg").className = "status-msg bad";
      });
  }

  function setStatus(msg, ok) {
    var e = document.getElementById("status-msg");
    e.textContent = msg;
    e.className = "status-msg " + (ok ? "ok" : "bad");
  }

  document.getElementById("reset-btn").addEventListener("click", function () {
    draftWeights[currentWeightHorizon] = Object.assign({}, savedWeights[currentWeightHorizon] || {});
    renderSliders();
    setStatus("Reset to last saved weights.", true);
  });

  document.getElementById("save-btn").addEventListener("click", function () {
    var token = window.prompt("Admin token (set via wrangler secret ADMIN_TOKEN) -- required to save weights:");
    if (!token) return;
    var note = window.prompt("Optional note for this change (e.g. why you're adjusting it):") || undefined;
    fetch("/weights", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ horizon: currentWeightHorizon, weights: draftWeights[currentWeightHorizon], note: note }),
    })
      .then(function (r) { return r.json().then(function (data) { return { status: r.status, data: data }; }); })
      .then(function (res) {
        if (res.status !== 200) { setStatus("Save failed: " + (res.data.error || res.status), false); return; }
        savedWeights[currentWeightHorizon] = Object.assign({}, draftWeights[currentWeightHorizon]);
        setStatus("Saved. Click \\"Recompute decisions now\\" to see it reflected below.", true);
      })
      .catch(function () { setStatus("Save failed: network error.", false); });
  });

  document.getElementById("recompute-btn").addEventListener("click", function () {
    var token = window.prompt("Admin token -- required to trigger a manual recompute:");
    if (!token) return;
    setStatus("Recomputing…", true);
    fetch("/decide", { method: "POST", headers: { authorization: "Bearer " + token } })
      .then(function (r) { return r.json().then(function (data) { return { status: r.status, data: data }; }); })
      .then(function (res) {
        if (res.status !== 200) { setStatus("Recompute failed: " + (res.data.error || res.status), false); return; }
        setStatus("Recomputed " + res.data.summary.tickersDecided + " tickers.", true);
        loadDecisions();
      })
      .catch(function () { setStatus("Recompute failed: network error.", false); });
  });

  renderHorizonTabs();
  loadDecisions();
  loadWeights();
})();
</script>
</body>
</html>`;
}
