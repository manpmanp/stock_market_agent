// Second, independent dashboard page for the 10-factor decision engine
// (src/decision/*), served at GET /decision-lab. Deliberately a separate
// route/page from GET /dashboard (src/dashboard.ts), which stays exactly
// as it was -- per the explicit instruction to keep the two systems
// comparable side by side rather than merging or replacing either. Shares
// the same color-system tokens as dashboard.ts (same validated palette)
// purely for visual family, not code -- no imports between the two pages.
//
// This is stock_agent_v1_7 -- the active playground for the v7 work
// (data-driven, self-tuning model selection + backtest harness), forked
// from stock_agent_v1_6, which stays frozen as the last known-good
// reference exactly like v1_5 was frozen when v1_6 was created. Same
// Worker name and D1 database as v6 (see wrangler.toml) -- only one of
// v6/v7 is ever actually deployed at a time.
//
// The old "How the algorithm works" / "How weight tuning works"
// collapsible pair was restructured into a single "Methodology" control
// in the page header, opening a tabbed panel (Factors & Inputs / Glossary
// / Scoring & Decisions / Weight Tuning / Model Selection & Testing) --
// one flat dropdown didn't scale once the model-selection content was
// added, per explicit instruction to organize it more readably.
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
    /* Model Results tab: one fixed hue per model, in a fixed order,
       distinct from the status colors above (see dataviz palette check --
       validated with scripts/validate_palette.js "#2a78d6,#1baf7a,#4a3aa7"
       --mode light and the dark equivalent below). Never cycled/reassigned
       -- linear is always this blue, gbm always this aqua, tabpfn always
       this violet, everywhere on this tab. */
    --model-linear:   #2a78d6;
    --model-gbm:      #1baf7a;
    --model-tabpfn:   #4a3aa7;
    /* Diverging scale for the feature/label correlation heatmap (-1..0..1)
       -- blue<->red poles with a neutral gray midpoint, per dataviz's
       diverging-pair guidance. Read via getComputedStyle at render time so
       light/dark just falls out of the cascade, same as everything else
       on this page. */
    --div-neg: #e34948;
    --div-mid: #f0efec;
    --div-pos: #2a78d6;
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
      --model-linear:   #3987e5;
      --model-gbm:      #199e70;
      --model-tabpfn:   #9085e9;
      --div-neg: #e66767;
      --div-mid: #383835;
      --div-pos: #3987e5;
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
  .page-header-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
  .page-header-row h1 { margin: 0; }
  .methodology-toggle { font-size: 12px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-1); color: var(--text-secondary); cursor: pointer; white-space: nowrap; }
  .methodology-toggle[aria-expanded="true"] { color: var(--text-primary); border-color: var(--seq-400); font-weight: 600; }
  .methodology-panel { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 36px; }
  .methodology-panel[hidden] { display: none; }
  .method-section { display: none; }
  .method-section.active { display: block; }
  .method-body { font-size: 13px; color: var(--text-secondary); }
  .method-body h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-muted); margin: 16px 0 8px; }
  .method-body h3:first-child { margin-top: 4px; }
  .method-body h4 { font-size: 12px; color: var(--text-primary); margin: 14px 0 6px; }
  .method-body h4:first-child { margin-top: 0; }
  .method-body p { margin: 0 0 8px; }
  .method-body ul { margin: 0 0 8px; padding-left: 18px; }
  .method-body li { margin-bottom: 4px; }
  .method-body table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 6px 0 10px; }
  .method-body th, .method-body td { text-align: left; padding: 4px 8px 4px 0; border-bottom: 1px solid var(--border); }
  .method-body th { color: var(--text-muted); font-weight: 600; }
  .method-body code { background: var(--gridline); border-radius: 4px; padding: 1px 5px; font-size: 12px; }
  .term-row { padding: 7px 0; border-top: 1px solid var(--border); }
  .term-row:first-child { border-top: none; }
  .term-name { font-weight: 600; font-size: 12px; color: var(--text-primary); }
  .term-name .term-full { font-weight: 400; font-size: 11px; color: var(--text-muted); margin-left: 5px; }
  .term-def { font-size: 12px; color: var(--text-secondary); margin-top: 3px; }
  .status-callout { background: var(--page); border: 1px solid var(--border); border-left: 3px solid var(--seq-400); border-radius: 6px; padding: 10px 12px; font-size: 12px; color: var(--text-secondary); margin: 10px 0 16px; }
  .model-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin: 8px 0 16px; }
  .model-card { background: var(--page); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  .model-card.selected { border-color: var(--seq-400); }
  .model-card .mc-name { font-weight: 700; font-size: 13px; margin-bottom: 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .model-card .mc-badge { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 2px 6px; border-radius: 999px; background: var(--seq-100); color: var(--seq-400); }
  .model-card .mc-desc { font-size: 11px; color: var(--text-secondary); margin-bottom: 8px; }
  .model-card .mc-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-muted); margin-top: 6px; }
  .model-card ul { margin: 2px 0 0; padding-left: 16px; font-size: 11px; color: var(--text-secondary); }
  .model-card .mc-pro-label { color: var(--status-good); }
  .model-card .mc-con-label { color: var(--status-bad); }
  .mr-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; color: var(--text-secondary); margin: 4px 0 18px; }
  .mr-legend-item { display: inline-flex; align-items: center; gap: 5px; }
  .mr-legend-swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .mr-horizon { margin-bottom: 30px; padding-bottom: 6px; }
  .mr-horizon:not(:last-child) { border-bottom: 1px solid var(--border); padding-bottom: 26px; }
  .mr-horizon h4 { font-size: 13px; margin: 0 0 4px; }
  .mr-context { font-size: 11px; color: var(--text-muted); margin-bottom: 12px; }
  .mr-chart-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-muted); margin: 14px 0 6px; font-weight: 600; }
  .mr-metric-row { display: grid; grid-template-columns: 130px 1fr 68px; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 12px; }
  .mr-metric-row .mr-label { color: var(--text-secondary); }
  .mr-bar-track { position: relative; height: 10px; border-radius: 5px; background: var(--gridline); overflow: hidden; }
  .mr-bar-fill { position: absolute; top: 0; bottom: 0; border-radius: 5px; min-width: 2px; }
  .mr-bar-track-signed .mr-bar-zero { position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background: var(--border); z-index: 1; }
  .mr-metric-row .mr-val { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-muted); white-space: nowrap; }
  .mr-table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 6px 0 4px; }
  .mr-table th, .mr-table td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid var(--border); }
  .mr-table th { color: var(--text-muted); font-weight: 600; font-size: 11px; }
  .mr-badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px; }
  .mr-badge-yes { background: var(--status-good); color: #fff; }
  .mr-badge-no { background: var(--gridline); color: var(--text-muted); }
  .mr-p { color: var(--text-muted); font-size: 11px; margin-left: 4px; }
  .mr-sub { font-size: 11px; color: var(--text-muted); margin: 2px 0 10px; max-width: 640px; }
  .mr-heatmap-wrap { overflow-x: auto; margin: 8px 0 18px; }
  .mr-heatmap { border-collapse: collapse; font-size: 9px; }
  .mr-heatmap th.mr-col-label { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 9px; font-weight: 400; color: var(--text-secondary); height: 88px; vertical-align: bottom; padding-bottom: 4px; white-space: nowrap; }
  .mr-heatmap th.mr-row-label { text-align: right; padding-right: 6px; font-size: 9px; font-weight: 400; color: var(--text-secondary); white-space: nowrap; }
  .mr-heatmap td.mr-cell { width: 25px; height: 22px; text-align: center; font-variant-numeric: tabular-nums; color: #fff; text-shadow: 0 0 2px rgba(0,0,0,0.45); }
  .mr-heatmap .mr-label-col { border-left: 2px solid var(--border); }
  .mr-heatmap .mr-label-row th, .mr-heatmap .mr-label-row td { border-top: 2px solid var(--border); }
  .mr-pd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin: 8px 0 18px; }
  .mr-pd-card { background: var(--page); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; }
  .mr-pd-card svg { display: block; width: 100%; height: 56px; }
  .mr-pd-label { font-size: 10px; color: var(--text-secondary); margin-top: 2px; }
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
  <div class="page-header-row">
    <h1>Decision Lab</h1>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <button id="methodology-toggle" class="methodology-toggle" aria-expanded="false" aria-controls="methodology-panel">Methodology &#9662;</button>
      <button id="model-results-toggle" class="methodology-toggle" aria-expanded="false" aria-controls="model-results-panel">Model Results &#9662;</button>
    </div>
  </div>
  <p class="sub">A second, independent 10-factor decision engine (quality, growth, financial strength, valuation, future potential, technical, entry, risk, catalyst, market regime), run alongside the main watchlist for comparison. Weights are stored in the database and can be tuned below without redeploying. This build (v7) is also where a data-driven, self-tuning model is being developed and tested -- see Methodology &rarr; Model Selection &amp; Testing for status.</p>
  <p class="note">Catalyst has no news/events data source wired in yet, so it's currently a flagged neutral placeholder -- a future version could add one (see Methodology above). Market regime is a real (if simple) live computation from a broad market-index proxy, not this ticker's own data. Data-driven research output, not investment advice.</p>

  <section id="methodology-panel" class="methodology-panel" hidden>
    <div class="tabs" id="method-tabs" role="tablist">
      <button class="tab" role="tab" data-section="factors" aria-selected="true">Factors &amp; Inputs</button>
      <button class="tab" role="tab" data-section="glossary" aria-selected="false">Glossary</button>
      <button class="tab" role="tab" data-section="scoring" aria-selected="false">Scoring &amp; Decisions</button>
      <button class="tab" role="tab" data-section="tuning" aria-selected="false">Weight Tuning</button>
      <button class="tab" role="tab" data-section="model" aria-selected="false">Model Selection &amp; Testing</button>
    </div>

    <div class="method-section active" data-section="factors">
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
          <tr><td>Technical</td><td>RSI (14-day), MACD vs. its signal line, price vs. 50-day average, price vs. 200-day average -- see the Glossary tab for what each one means and how to read the numbers</td></tr>
          <tr><td>Entry</td><td>This ticker's own trend-state read (pullback in an uptrend / near highs / downtrend / neutral) plus RSI -- is right now, specifically, a reasonable point to buy</td></tr>
          <tr><td>Risk</td><td>30-day volatility, debt-to-equity, distance from this ticker's own high, Beta -- higher score = lower risk</td></tr>
          <tr><td>Catalyst</td><td>Currently a flagged neutral placeholder (50) in this version -- no news/events data source is wired in yet (planned for a future version, not this one)</td></tr>
          <tr><td>Market regime</td><td>One shared reading per run, from a market-index proxy's (SPY) own trend -- not this ticker's own data, so it moves every ticker together, not against each other</td></tr>
        </table>
        <p class="note">P/E, EV/EBITDA, payout ratio, and the analyst recommendation/price-target spread are shown on each card as supporting metrics but aren't blended into any factor score -- see "Valuation & balance-sheet multiples" and "Analyst cross-check" on the decision cards below.</p>
      </div>
    </div>

    <div class="method-section" data-section="glossary">
      <div class="method-body">
        <p>What each technical or financial term means, and how this engine specifically reads the number -- grouped by what kind of read it feeds.</p>
        <h4>Momentum &amp; trend (feeds Technical, Entry, Risk)</h4>
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
          <div class="term-name">Distance from high</div>
          <div class="term-def">How far the current price sits below its own highest close in the lookback window, as a percentage -- a drawdown read specific to this ticker's own history. 0% = at its own high; more negative = a deeper pullback. Used in the Risk factor (a very deep drawdown reads as elevated risk), separate from the Entry factor's read on whether a pullback looks like a buying opportunity.</div>
        </div>
        <div class="term-row">
          <div class="term-name">Beta</div>
          <div class="term-def">How much a stock has tended to move relative to the broader market: 1.0 means it moves roughly in line with the market, above 1.0 means historically more volatile than the market (bigger swings both up and down), below 1.0 means historically calmer than the market. Distinct from this ticker's own (absolute) 30-day volatility -- a stock can be internally calm but still carry a high beta if its calm periods and volatile periods both track the market's. Feeds the Risk factor; this engine treats ~0.5 as low-risk and ~2.0+ as high-risk.</div>
        </div>
        <h4>Valuation &amp; leverage (feeds Valuation, Financial Strength)</h4>
        <div class="term-row">
          <div class="term-name">PEG ratio <span class="term-full">Price/Earnings-to-Growth ratio</span></div>
          <div class="term-def">P/E divided by the expected earnings growth rate -- a growth-adjusted valuation multiple. Roughly, under ~1 is historically considered potentially cheap relative to growth, over ~2-3 potentially expensive. Feeds the Future Potential proxy here, not the Valuation factor itself.</div>
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
          <div class="term-name">Debt-to-equity <span class="term-full">D/E ratio</span></div>
          <div class="term-def">Total debt divided by shareholder equity -- how leveraged the company is. Lower is generally safer. Used in both Financial Strength and Risk here, since heavy leverage cuts both ways: less resilient, and riskier.</div>
        </div>
        <h4>Profitability (feeds Quality, Financial Strength)</h4>
        <div class="term-row">
          <div class="term-name">ROE <span class="term-full">Return on Equity</span></div>
          <div class="term-def">Net income divided by shareholder equity -- how efficiently the company turns shareholders' capital into profit. Higher is generally better; this engine treats roughly 8% as the low end of "decent" and 30%+ as excellent for scoring purposes.</div>
        </div>
        <div class="term-row">
          <div class="term-name">ROA <span class="term-full">Return on Assets</span></div>
          <div class="term-def">Net income divided by total assets -- how efficiently the company turns everything it owns (debt-funded or not) into profit. Complements ROE, which only measures profit against shareholder equity and so can be inflated by leverage (a highly-indebted company can post a high ROE on a thin equity base) -- ROA can't be inflated that way. Higher is better; this engine treats ~3% as the low end of "decent" and ~15%+ as excellent. Feeds Quality alongside the margin and ROE reads.</div>
        </div>
        <div class="term-row">
          <div class="term-name">FCF yield <span class="term-full">Free Cash Flow Yield</span></div>
          <div class="term-def">Free cash flow divided by market cap -- how much real cash the business throws off relative to what you're paying for it. Higher is generally better.</div>
        </div>
        <div class="term-row">
          <div class="term-name">Payout ratio</div>
          <div class="term-def">The share of earnings paid out as dividends (dividends / net income). Not scored into any factor here -- a high payout ratio isn't automatically a bad sign (mature, stable-cash-flow businesses often run high payout ratios by design), so it doesn't map cleanly onto a single "higher/lower is better" band the way a leverage ratio does. Shown as a supporting metric on each card for the reader to weigh in context, e.g. alongside FCF yield and Net Debt/EBITDA.</div>
        </div>
        <h4>Analyst cross-check (never blended into the score)</h4>
        <div class="term-row">
          <div class="term-name">Analyst recommendations &amp; price targets</div>
          <div class="term-def">The current breakdown of sell-side analyst ratings (strong buy / buy / hold / sell / strong sell) and their low/mean/high 12-month price targets, both from Yahoo Finance. Shown as a cross-check on each card -- it's other analysts' independent view, useful for sanity-checking this engine's read, not an input to it.</div>
        </div>
      </div>
    </div>

    <div class="method-section" data-section="scoring">
      <div class="method-body">
        <h3>How a score becomes a decision</h3>
        <p>Each horizon (Short / Medium / Long) has its own weight vector -- see the Weight Tuning tab. The final score is a straight weighted average: each factor's 0-100 value &times; its weight for that horizon, summed. That score maps to a label through fixed bands: <code>&ge;85 STRONG BUY</code>, <code>&ge;75 BUY</code>, <code>&ge;65 ACCUMULATE</code>, <code>&ge;50 HOLD/WAIT</code>, <code>&ge;40 REDUCE</code>, <code>&ge;25 SELL</code>, below that <code>STRONG SELL</code>.</p>
        <h3>Confidence</h3>
        <p><b>Confidence is not another weighted average.</b> It's 100 minus the spread (standard deviation) across the 10 raw factor scores. If quality, growth, valuation, technical, etc. all broadly agree -- all high or all low -- confidence is high. If they disagree (say, elite quality but terrible technicals), confidence drops, regardless of what the final score comes out to. High dispersion means the evidence is mixed, not that the stock is secretly bullish or bearish.</p>
        <h3>Valuation &amp; entry status</h3>
        <p>Valuation status (e.g. <code>UNDERVALUED</code>) and entry status (e.g. <code>GOOD_ENTRY</code>) shown on each card are separate raw classifications -- not blended into the score -- so you can see the underlying read even when it's outweighed by other factors.</p>
      </div>
    </div>

    <div class="method-section" data-section="tuning">
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
    </div>

    <div class="method-section" data-section="model">
      <div class="method-body">
        <h3>Why a model at all</h3>
        <p>Manually tuning ten factor weights per horizon has no stopping rule -- there are effectively unlimited combinations to try, each one requiring a change, a wait, and a check, with no way to tell a real improvement from noise. A data-driven model that learns the weighting (or more) from actual outcomes replaces that open-ended search with something that can be evaluated on evidence -- but only if it's tested rigorously, not just swapped in and trusted.</p>
        <h3>Alternatives considered</h3>
        <div class="model-cards">
          <div class="model-card">
            <div class="mc-name">Linear / logistic regression</div>
            <div class="mc-desc">A weighted sum of the 10 factors -- same shape as the manual weights above, just fitted from data instead of typed in by hand.</div>
            <div class="mc-label mc-pro-label">Pros</div>
            <ul><li>Hardest to overfit with limited data</li><li>Fully transparent</li><li>Trivial to run in the Worker</li></ul>
            <div class="mc-label mc-con-label">Cons</div>
            <ul><li>Can't capture interactions between factors (e.g. "quality only matters when cheap too")</li></ul>
          </div>
          <div class="model-card">
            <div class="mc-name">Gradient-boosted trees (GBM)</div>
            <div class="mc-desc">A stack of simple threshold rules, each one correcting the mistakes of the ones before it.</div>
            <div class="mc-label mc-pro-label">Pros</div>
            <ul><li>Best track record on small, noisy, tabular data</li><li>Captures factor interactions natively</li><li>Feature importance stays readable</li><li>Cheap, dependency-free inference (just threshold checks)</li></ul>
            <div class="mc-label mc-con-label">Cons</div>
            <ul><li>Still needs real labeled outcomes to be any good</li></ul>
          </div>
          <div class="model-card">
            <div class="mc-name">TabPFN <span class="mc-badge">pretrained</span></div>
            <div class="mc-desc">A pretrained tabular foundation model, purpose-built for small, noisy tabular datasets like this one -- used directly rather than trained from scratch.</div>
            <div class="mc-label mc-pro-label">Pros</div>
            <ul><li>Designed for exactly this data regime (small N, tabular)</li><li>No training-from-scratch overfitting risk</li></ul>
            <div class="mc-label mc-con-label">Cons</div>
            <ul><li>More of a black box than the other two</li><li>Can't run natively in the Worker -- needs an offline batch-scoring step</li></ul>
          </div>
          <div class="model-card">
            <div class="mc-name">Small MLP (neural net)</div>
            <div class="mc-desc">A basic neural network over the 10 factor scores, flexible enough to bend curves between inputs and outcomes.</div>
            <div class="mc-label mc-pro-label">Pros</div>
            <ul><li>Can model nonlinear factor interactions</li></ul>
            <div class="mc-label mc-con-label">Cons</div>
            <ul><li>Needs more data than this project has to avoid fitting noise instead of signal</li><li>Not included in the initial harness -- only worth adding if linear/GBM/TabPFN show real headroom left on the table</li></ul>
          </div>
          <div class="model-card">
            <div class="mc-name">KAN</div>
            <div class="mc-desc">A neural-net variant where every connection gets its own learnable curve instead of a single weight -- strong at recovering clean, low-noise mathematical relationships.</div>
            <div class="mc-label mc-pro-label">Pros</div>
            <ul><li>Excellent fit for smooth, low-noise scientific/mathematical data</li></ul>
            <div class="mc-label mc-con-label">Cons</div>
            <ul><li>That extra flexibility fits noise, not signal, on small noisy financial data -- the wrong tool for this problem</li><li>Slower to train, no simple path to Worker-side inference</li></ul>
          </div>
          <div class="model-card">
            <div class="mc-name">Deep net on raw data</div>
            <div class="mc-desc">Skips the 10-factor abstraction entirely, learning directly from raw fundamentals/technicals.</div>
            <div class="mc-label mc-pro-label">Pros</div>
            <ul><li>Most flexible in theory</li></ul>
            <div class="mc-label mc-con-label">Cons</div>
            <ul><li>Needs far more data than a small ticker universe provides</li><li>Loses the factor-level explainability the rest of this page is built around</li></ul>
          </div>
        </div>
        <h3>What was chosen, and why</h3>
        <p>Linear regression as the mandatory baseline, gradient-boosted trees as the primary candidate, and TabPFN as a purpose-built third option -- all three compared side by side in the same test harness, rather than picking one on judgment alone. Nothing fancier gets used for live scoring unless it beats the plain linear baseline by a real, statistically checked margin. KAN and a raw-data deep net were ruled out up front as mismatched to this project's data size and noise level; a small MLP is held in reserve, added only if the harness itself shows there's headroom the other three are leaving on the table.</p>
        <h3>Testing method</h3>
        <p>A walk-forward backtest, not a random train/test split -- random shuffling would let a model learn from outcomes that, in real use, hadn't happened yet.</p>
        <ul>
          <li><b>Point-in-time features.</b> Technical indicators are recomputed as they would have looked on each historical date, from the 5 years of daily price history already collected -- not today's values applied backward.</li>
          <li><b>Expanding walk-forward.</b> Train on data through year Y, test (never train) on year Y+1; fold that year into training and test the next; repeat across the available history.</li>
          <li><b>An embargo gap</b> at each train/test boundary, sized to the longest indicator lookback or forward-return horizon, so no window can overlap across the line and leak future information backward.</li>
          <li><b>An untouched final holdout</b> -- the most recent 6-12 months, never used for training or model selection, checked only once at the end as the one number that counts.</li>
          <li><b>Metrics:</b> hit rate and rank correlation (does the score actually order tickers by future return, not just guess close numbers), plus portfolio-level Sharpe ratio and max drawdown against a SPY benchmark if top-scored tickers were actually acted on.</li>
          <li><b>Significance check.</b> A bootstrap/permutation test on top of the above, since with this few tickers a model can look better than another purely by chance -- a "win" has to survive that check before it's trusted.</li>
          <li><b>Automatic hyperparameter tuning.</b> Linear and GBM's own settings (Ridge's regularization strength; GBM's tree depth/learning rate) aren't fixed -- each fold runs its own small search on an inner slice carved out of just that fold's training window (never touching that fold's test data), and picks whichever setting scored best there. This lets the chosen configuration track new patterns as more history accumulates instead of guessing once and freezing it -- see Model Results for the actual fold-by-fold record of what got chosen. TabPFN has no comparable hyperparameters to search.</li>
        </ul>
        <div class="status-callout">
          <b>What is selected today:</b> nothing yet -- the backtest harness runs and its results are published (see the "Model Results" button next to the page title), but nothing from it is wired into live scoring. Live decisions on this page still use the hand-set weights in the Weight Tuning tab. A model only gets adopted here once it beats the linear baseline by a real, statistically-checked margin -- see Model Results for whether that's happened yet.
        </div>
        <h3>Known limits</h3>
        <p>This backtest is only fully honest for the technical/price-based factors, which have genuine point-in-time history going back 5 years. Fundamentals-driven factors (quality, valuation, etc.) don't have point-in-time history available at this project's current data budget -- their outcomes accrue live, going forward, rather than from backtesting, and the model won't be extended to lean on them until that live history exists. Catalyst/news-based scoring (e.g. via an LLM reading filings or news) was considered and deliberately deferred to a future version -- out of scope here.</p>
      </div>
    </div>
  </section>

  <section id="model-results-panel" class="methodology-panel" hidden>
    <div class="method-body">
      <h3>Model Results</h3>
      <p>Actual output from the last time <code>scripts/backtest.sh</code> ran on your machine -- the same walk-forward comparison described in Methodology &rarr; Model Selection &amp; Testing, but the real numbers instead of the plan. Per horizon: comparison metrics, then the automatic hyperparameter tuning record (what got chosen per fold, and why that can change fold to fold), then three interpretability views -- feature importance (what each model leaned on), feature/label correlations (how the raw technical inputs relate to each other and to actual outcomes), and partial dependence (each input's own learned effect). This covers the technical/price-based features only, not the full 10-factor decision engine -- see Methodology &rarr; Model Selection &amp; Testing's "Known limits" for why. Nothing here changes live decisions by itself (see the status callout there); this is the evidence you'd need before it did.</p>
      <div id="model-results-content"><div class="empty">Loading&hellip;</div></div>
    </div>
  </section>

  <section>
    <h2>Decisions</h2>
    <p class="note" style="margin-bottom: 14px;">Each card's <b>Decision</b> badge is the weighted average of all 10 factors (see Methodology). Its <b>Entry</b> and <b>Valuation</b> readings next to it are each just one factor's own score, shown separately on purpose -- they can disagree with the overall Decision, and with each other. A weak entry timing can still sit inside a Buy (the other 9 factors carried it); a good entry can still sit inside an Accumulate (something else pulled the average down). Sort/rank always follows the overall score, not either of these two.</p>
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
  // Every status this page shows (decision, valuation_status, entry_status)
  // comes off the engine as a SCREAMING_SNAKE_CASE or ALL CAPS constant --
  // fine for code, inconsistent to read side by side on a card. One shared
  // formatter so "STRONG BUY", "WEAK_ENTRY", and "DEEPLY_UNDERVALUED" all
  // render the same way: "Strong buy", "Weak entry", "Deeply undervalued".
  function sentenceCase(s) {
    if (!s) return s;
    var lower = String(s).replace(/_/g, " ").toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
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

  // --- Model Results (backtest output) ---

  var MODEL_COLORS = { linear: "var(--model-linear)", gbm: "var(--model-gbm)", tabpfn: "var(--model-tabpfn)" };
  var MODEL_LABELS = { linear: "Linear (baseline)", gbm: "GBM", tabpfn: "TabPFN" };
  var FEATURE_LABELS = {
    rsi14: "RSI (14d)", macd: "MACD", macd_signal: "MACD signal",
    price_vs_sma50: "Price vs SMA50", price_vs_sma200: "Price vs SMA200",
    volatility_30d: "Volatility (30d)", volume_trend_20d: "Volume trend (20d)",
    price_range_pct: "Price range %ile", dist_from_high_pct: "Dist. from high", dist_from_low_pct: "Dist. from low",
    trend_pullback: "Trend: pullback", trend_near_high: "Trend: near high", trend_downtrend: "Trend: downtrend", trend_neutral: "Trend: neutral",
    label_forward_return: "Forward return",
  };

  function hexToRgb(hex) {
    hex = String(hex).replace("#", "");
    return [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)];
  }
  function lerpRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  var _divColors = null;
  function divergingColor(v) {
    // v in [-1, 1]. Reads the current theme's --div-neg/--div-mid/--div-pos
    // once and caches -- these are static per page load (theme doesn't
    // change without a reload), and this runs per heatmap cell.
    if (!_divColors) {
      var cs = getComputedStyle(document.documentElement);
      _divColors = {
        neg: hexToRgb(cs.getPropertyValue("--div-neg").trim() || "#e34948"),
        mid: hexToRgb(cs.getPropertyValue("--div-mid").trim() || "#f0efec"),
        pos: hexToRgb(cs.getPropertyValue("--div-pos").trim() || "#2a78d6"),
      };
    }
    var clamped = Math.max(-1, Math.min(1, v === null || v === undefined ? 0 : v));
    var rgb = clamped >= 0 ? lerpRgb(_divColors.mid, _divColors.pos, clamped) : lerpRgb(_divColors.mid, _divColors.neg, -clamped);
    return "rgb(" + rgb.map(function (c) { return Math.round(c); }).join(",") + ")";
  }

  /** Plain left-to-right bar for an always-nonnegative metric (e.g. hit rate 0-1). */
  function metricBarRow(label, value, colorVar, domainMax, valueText) {
    var track = el("div", { class: "mr-bar-track" });
    var pct = domainMax > 0 ? Math.max(0, Math.min(100, (value / domainMax) * 100)) : 0;
    track.appendChild(el("div", { class: "mr-bar-fill", style: "left:0;width:" + pct.toFixed(1) + "%;background:" + colorVar + ";" }));
    return el("div", { class: "mr-metric-row" }, [el("div", { class: "mr-label", text: label }), track, el("div", { class: "mr-val", text: valueText })]);
  }

  /** Zero-anchored bar for a metric that can go negative (e.g. IC). Extends
   *  right from center for a positive value, left for negative -- so sign
   *  is visible in the geometry, not just the number. */
  function signedBarRow(label, value, colorVar, domainMax, valueText) {
    var track = el("div", { class: "mr-bar-track mr-bar-track-signed" });
    track.appendChild(el("div", { class: "mr-bar-zero" }));
    var widthPct = domainMax > 0 ? Math.max(0, Math.min(50, (Math.abs(value) / domainMax) * 50)) : 0;
    var leftPct = value >= 0 ? 50 : 50 - widthPct;
    track.appendChild(el("div", { class: "mr-bar-fill", style: "left:" + leftPct.toFixed(1) + "%;width:" + widthPct.toFixed(1) + "%;background:" + colorVar + ";" }));
    return el("div", { class: "mr-metric-row" }, [el("div", { class: "mr-label", text: label }), track, el("div", { class: "mr-val", text: valueText })]);
  }

  function formatParams(model, params) {
    if (!params) return "default";
    if (model === "linear") return "α=" + params.alpha;
    if (model === "gbm") return "depth=" + params.max_depth + ", lr=" + params.learning_rate + ", n=" + params.n_estimators;
    return JSON.stringify(params);
  }

  function renderTuningHistory(h) {
    var tuning = h.tuning;
    if (!tuning || !tuning.per_fold || (!tuning.per_fold.linear && !tuning.per_fold.gbm)) return null;
    var wrap = el("div", {});
    wrap.appendChild(el("div", { class: "mr-chart-title", text: "Hyperparameter tuning -- chosen automatically, per fold" }));
    wrap.appendChild(el("div", {
      class: "mr-sub",
      text: "Linear and GBM's own settings aren't fixed -- each fold re-runs a small search on an inner slice of just that fold's own training window (never touching the fold's test data) and picks whichever setting scored best there. Reading down the Params column shows whether/how the choice actually shifted as more history came in.",
    }));
    if (tuning.final && (tuning.final.linear || tuning.final.gbm)) {
      var bits = [];
      if (tuning.final.linear) bits.push("Linear: " + formatParams("linear", tuning.final.linear.params));
      if (tuning.final.gbm) bits.push("GBM: " + formatParams("gbm", tuning.final.gbm.params));
      wrap.appendChild(el("div", { class: "status-callout", text: "Used for the final holdout (and for feature importance / partial dependence below) -- " + bits.join("; ") + "." }));
    }
    ["linear", "gbm"].forEach(function (m) {
      var rows = tuning.per_fold[m];
      if (!rows || !rows.length) return;
      wrap.appendChild(el("div", { class: "mr-imp-title", text: MODEL_LABELS[m] }));
      var table = el("table", { class: "mr-table" });
      table.appendChild(el("tr", {}, ["Test quarter", "Chosen params", "Inner validation IC"].map(function (t) { return el("th", { text: t }); })));
      rows.forEach(function (r) {
        table.appendChild(el("tr", {}, [
          el("td", { text: r.test_quarter }),
          el("td", { text: formatParams(m, r.params) }),
          el("td", { text: r.inner_validation_ic === null || r.inner_validation_ic === undefined ? "n/a (default used)" : r.inner_validation_ic.toFixed(3) }),
        ]));
      });
      wrap.appendChild(table);
    });
    return wrap;
  }

  function renderFeatureImportance(h) {
    var fi = h.feature_importance || {};
    var modelsWithFi = ["linear", "gbm"].filter(function (m) { return fi[m] && fi[m].length; });
    if (!modelsWithFi.length) return null;
    var wrap = el("div", {});
    wrap.appendChild(el("div", { class: "mr-chart-title", text: "Feature importance -- what each model actually leaned on" }));
    wrap.appendChild(el("div", { class: "mr-sub", text: "Ranked share of each model's own decision-making, extracted from the fitted model itself (GBM: impurity-based; Linear: standardized |coefficient|). TabPFN has no simple global-importance readout, so it's not shown here." }));
    modelsWithFi.forEach(function (m) {
      var rows = fi[m].slice().sort(function (a, b) { return b.importance - a.importance; });
      var maxImp = Math.max.apply(null, rows.map(function (r) { return r.importance; })) || 1;
      wrap.appendChild(el("div", { class: "mr-imp-title", text: MODEL_LABELS[m] }));
      rows.forEach(function (r) {
        wrap.appendChild(metricBarRow(FEATURE_LABELS[r.feature] || r.feature, r.importance, MODEL_COLORS[m], maxImp * 1.05, (r.importance * 100).toFixed(1) + "%"));
      });
    });
    return wrap;
  }

  function renderCorrelationHeatmap(h) {
    var c = h.correlations;
    if (!c || !c.matrix) return null;
    var labels = c.labels;
    var wrap = el("div", {});
    wrap.appendChild(el("div", { class: "mr-chart-title", text: "Feature & label correlations (Pearson, n=" + c.n + ")" }));
    wrap.appendChild(el("div", { class: "mr-sub", text: "How the raw technical inputs relate to each other, and to the actual realized forward return (rightmost column/bottom row) -- blue = positive, red = negative, gray = no relationship. High correlation between two features means they're carrying overlapping information, not two independent signals." }));
    var wrapDiv = el("div", { class: "mr-heatmap-wrap" });
    var table = el("table", { class: "mr-heatmap" });
    var headRow = el("tr");
    headRow.appendChild(el("th"));
    labels.forEach(function (l, i) {
      var th = el("th", { class: "mr-col-label" + (i === labels.length - 1 ? " mr-label-col" : ""), text: FEATURE_LABELS[l] || l });
      headRow.appendChild(th);
    });
    table.appendChild(headRow);
    labels.forEach(function (rowLabel, ri) {
      var tr = el("tr", { class: ri === labels.length - 1 ? "mr-label-row" : "" });
      tr.appendChild(el("th", { class: "mr-row-label", text: FEATURE_LABELS[rowLabel] || rowLabel }));
      c.matrix[ri].forEach(function (v, ci) {
        var cell = el("td", {
          class: "mr-cell" + (ci === labels.length - 1 ? " mr-label-col" : ""),
          style: "background:" + divergingColor(v) + ";",
          title: (FEATURE_LABELS[rowLabel] || rowLabel) + " vs " + (FEATURE_LABELS[labels[ci]] || labels[ci]) + ": " + (v === null ? "n/a" : v.toFixed(2)),
          text: v === null ? "" : v.toFixed(2),
        });
        tr.appendChild(cell);
      });
      table.appendChild(tr);
    });
    wrapDiv.appendChild(table);
    wrap.appendChild(wrapDiv);
    return wrap;
  }

  function svgSparkline(points, color, yDomain) {
    var W = 140, H = 56, PAD = 4;
    var xs = points.map(function (p) { return p.x; });
    var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
    var yMin = yDomain[0], yMax = yDomain[1];
    var yRange = yMax - yMin || 1;
    var xRange = xMax - xMin || 1;
    function px(x) { return PAD + ((x - xMin) / xRange) * (W - 2 * PAD); }
    function py(y) { return H - PAD - ((y - yMin) / yRange) * (H - 2 * PAD); }
    var d = points.map(function (p, i) { return (i === 0 ? "M" : "L") + px(p.x).toFixed(1) + "," + py(p.y).toFixed(1); }).join(" ");
    var zeroY = py(0).toFixed(1);
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    if (yMin < 0 && yMax > 0) {
      var zeroLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      zeroLine.setAttribute("x1", String(PAD)); zeroLine.setAttribute("x2", String(W - PAD));
      zeroLine.setAttribute("y1", zeroY); zeroLine.setAttribute("y2", zeroY);
      zeroLine.setAttribute("stroke", "var(--border)"); zeroLine.setAttribute("stroke-width", "1"); zeroLine.setAttribute("stroke-dasharray", "2,2");
      svg.appendChild(zeroLine);
    }
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  function renderPartialDependence(h) {
    var pd = h.partial_dependence;
    if (!pd || !Object.keys(pd).length) return null;
    var wrap = el("div", {});
    wrap.appendChild(el("div", { class: "mr-chart-title", text: "Partial dependence (GBM) -- each feature's own learned effect" }));
    wrap.appendChild(el("div", { class: "mr-sub", text: "For each input: every OTHER feature held at its typical (median) value, this one swept across its real 5th-95th percentile range. The line is the model's predicted return at each point -- a flat line means the model essentially ignores that input; a shape that contradicts intuition (e.g. RSI not peaking near 50) is worth double-checking before trusting the model." }));
    var allY = [];
    Object.keys(pd).forEach(function (f) { pd[f].forEach(function (p) { allY.push(p.y); }); });
    var yMin = Math.min.apply(null, allY), yMax = Math.max.apply(null, allY);
    if (yMin === yMax) { yMin -= 0.001; yMax += 0.001; }
    var pad = (yMax - yMin) * 0.1;
    var yDomain = [yMin - pad, yMax + pad];
    var grid = el("div", { class: "mr-pd-grid" });
    Object.keys(pd).forEach(function (f) {
      var card = el("div", { class: "mr-pd-card" });
      card.appendChild(svgSparkline(pd[f], "var(--model-gbm)", yDomain));
      card.appendChild(el("div", { class: "mr-pd-label", text: FEATURE_LABELS[f] || f }));
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function renderHorizonResult(h) {
    var wrap = el("div", { class: "mr-horizon" });
    wrap.appendChild(el("h4", { text: "Horizon: " + h.horizon.charAt(0).toUpperCase() + h.horizon.slice(1) }));
    if (h.skipped) {
      wrap.appendChild(el("div", { class: "empty", text: "Skipped -- " + h.reason }));
      return wrap;
    }
    wrap.appendChild(el("div", {
      class: "mr-context",
      text: h.quarters_total + " quarters of history -- " + h.walk_forward_quarters + " used for walk-forward folds, last " + h.holdout_quarters.length + " held out untouched as the final holdout.",
    }));

    var models = h.models_evaluated || [];

    var icVals = models.map(function (m) { var v = h.walk_forward[m].mean_ic; return v === null || v === undefined ? 0 : v; });
    var icDomain = Math.max(0.02, Math.max.apply(null, icVals.map(Math.abs)) * 1.25);
    wrap.appendChild(el("div", { class: "mr-chart-title", text: "Information coefficient (rank correlation with actual return) -- walk-forward" }));
    models.forEach(function (m) {
      var v = h.walk_forward[m].mean_ic;
      wrap.appendChild(signedBarRow(MODEL_LABELS[m] || m, v === null || v === undefined ? 0 : v, MODEL_COLORS[m], icDomain, v === null || v === undefined ? "n/a (0 folds)" : v.toFixed(3)));
    });

    wrap.appendChild(el("div", { class: "mr-chart-title", text: "Hit rate (directionally correct calls) -- walk-forward" }));
    models.forEach(function (m) {
      var v = h.walk_forward[m].mean_hit_rate;
      wrap.appendChild(metricBarRow(MODEL_LABELS[m] || m, v === null || v === undefined ? 0 : v, MODEL_COLORS[m], 1, v === null || v === undefined ? "n/a" : fmtPct(v)));
    });

    var table = el("table", { class: "mr-table" });
    table.appendChild(el("tr", {}, ["Model", "Folds", "Sharpe", "Max drawdown", "Excess vs. benchmark", "Beats linear?"].map(function (t) { return el("th", { text: t }); })));
    models.forEach(function (m) {
      var w = h.walk_forward[m];
      var sig = (h.significance_vs_linear && h.significance_vs_linear[m]) || {};
      var beatsCell = el("td");
      if (m === "linear") {
        beatsCell.textContent = "--";
      } else {
        beatsCell.appendChild(el("span", { class: "mr-badge " + (sig.beats_linear ? "mr-badge-yes" : "mr-badge-no"), text: sig.beats_linear ? "yes" : "no" }));
        if (sig.bootstrap_p_not_better_than_linear !== null && sig.bootstrap_p_not_better_than_linear !== undefined) {
          beatsCell.appendChild(el("span", { class: "mr-p", text: "p=" + fmt(sig.bootstrap_p_not_better_than_linear, 2) }));
        }
      }
      table.appendChild(el("tr", {}, [
        el("td", { text: MODEL_LABELS[m] || m }),
        el("td", { text: String(w.folds_evaluated) }),
        el("td", { text: fmt(w.sharpe, 2) }),
        el("td", { text: fmt(w.max_drawdown, 3) }),
        el("td", { text: w.mean_excess_return_vs_benchmark === null || w.mean_excess_return_vs_benchmark === undefined ? "–" : fmtPct(w.mean_excess_return_vs_benchmark) }),
        beatsCell,
      ]));
    });
    wrap.appendChild(table);

    wrap.appendChild(el("div", { class: "mr-chart-title", text: "Final holdout (untouched during training/selection, evaluated once)" }));
    var htable = el("table", { class: "mr-table" });
    htable.appendChild(el("tr", {}, ["Model", "Hit rate", "IC", "Sharpe", "Max drawdown"].map(function (t) { return el("th", { text: t }); })));
    models.forEach(function (m) {
      var fh = h.final_holdout ? h.final_holdout[m] : null;
      htable.appendChild(el("tr", {}, [
        el("td", { text: MODEL_LABELS[m] || m }),
        el("td", { text: fh ? fmtPct(fh.hit_rate) : "–" }),
        el("td", { text: fh ? fmt(fh.ic, 3) : "–" }),
        el("td", { text: fh ? fmt(fh.sharpe, 2) : "–" }),
        el("td", { text: fh ? fmt(fh.max_drawdown, 3) : "–" }),
      ]));
    });
    wrap.appendChild(htable);

    var tuningSection = renderTuningHistory(h);
    if (tuningSection) wrap.appendChild(tuningSection);
    var fiSection = renderFeatureImportance(h);
    if (fiSection) wrap.appendChild(fiSection);
    var corrSection = renderCorrelationHeatmap(h);
    if (corrSection) wrap.appendChild(corrSection);
    var pdSection = renderPartialDependence(h);
    if (pdSection) wrap.appendChild(pdSection);

    return wrap;
  }

  function renderBacktestResults(payload) {
    var content = document.getElementById("model-results-content");
    content.innerHTML = "";
    var runs = payload.runs || [];
    if (!runs.length) {
      content.appendChild(el("div", {
        class: "empty",
        text: "No backtest results published yet. Run scripts/backtest.sh on your machine (see Methodology -> Model Selection & Testing for what it does) -- it publishes here automatically when it finishes.",
      }));
      return;
    }
    var latest = runs[0];
    content.appendChild(el("div", {
      class: "run-at",
      text: "Last published run (UTC): " + latest.createdAt + (runs.length > 1 ? " -- " + (runs.length - 1) + " earlier run(s) also on file" : ""),
    }));
    var legend = el("div", { class: "mr-legend" });
    ["linear", "gbm", "tabpfn"].forEach(function (m) {
      legend.appendChild(el("span", { class: "mr-legend-item" }, [
        el("i", { class: "mr-legend-swatch", style: "background:" + MODEL_COLORS[m] + ";" }),
        el("span", { text: MODEL_LABELS[m] }),
      ]));
    });
    content.appendChild(legend);
    var report = latest.report || {};
    (report.horizons || []).forEach(function (h) { content.appendChild(renderHorizonResult(h)); });
  }

  function loadBacktestResults() {
    var content = document.getElementById("model-results-content");
    content.innerHTML = '<div class="empty">Loading…</div>';
    fetch("/backtest-results")
      .then(function (r) { return r.json(); })
      .then(function (data) { renderBacktestResults(data); })
      .catch(function () { content.innerHTML = '<div class="empty">Failed to load backtest results.</div>'; });
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
      el("div", { class: "decision-badge " + decisionClass(d.decision), text: sentenceCase(d.decision) || "–" }),
    ]);
    card.appendChild(head);
    card.appendChild(el("div", { class: "meta-row" }, [
      el("span", {}, [document.createTextNode("Score: "), el("b", { text: fmt(d.score) })]),
      el("span", {}, [document.createTextNode("Confidence: "), el("b", { text: fmt(d.confidence) })]),
      el("span", { title: "Where price sits vs. estimated fair value -- not the Valuation factor score below, see the expanded card." }, [
        document.createTextNode("Valuation: "),
        el("b", { text: sentenceCase(d.valuation_status) || "–" }),
      ]),
      el("span", { title: "This ticker's own Entry factor score only (trend + RSI) -- independent of the Decision above, which blends all 10 weighted factors. A weak entry timing can still sit inside a Buy, and a good entry can still sit inside an Accumulate; they're answering different questions." }, [
        document.createTextNode("Entry: "),
        el("b", { text: sentenceCase(d.entry_status) || "–" }),
      ]),
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

  // --- Methodology panel ---

  var methodologyToggle = document.getElementById("methodology-toggle");
  var methodologyPanel = document.getElementById("methodology-panel");
  methodologyToggle.addEventListener("click", function () {
    var open = methodologyPanel.hasAttribute("hidden");
    if (open) { methodologyPanel.removeAttribute("hidden"); } else { methodologyPanel.setAttribute("hidden", ""); }
    methodologyToggle.setAttribute("aria-expanded", open ? "true" : "false");
    methodologyToggle.innerHTML = "Methodology " + (open ? "&#9652;" : "&#9662;");
  });

  var methodTabs = document.querySelectorAll("#method-tabs .tab");
  var methodSections = document.querySelectorAll(".method-section");
  methodTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var target = tab.getAttribute("data-section");
      methodTabs.forEach(function (t) { t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
      methodSections.forEach(function (s) { s.classList.toggle("active", s.getAttribute("data-section") === target); });
    });
  });

  // --- Model Results panel toggle (same pattern as Methodology above) ---

  var modelResultsToggle = document.getElementById("model-results-toggle");
  var modelResultsPanel = document.getElementById("model-results-panel");
  modelResultsToggle.addEventListener("click", function () {
    var open = modelResultsPanel.hasAttribute("hidden");
    if (open) { modelResultsPanel.removeAttribute("hidden"); } else { modelResultsPanel.setAttribute("hidden", ""); }
    modelResultsToggle.setAttribute("aria-expanded", open ? "true" : "false");
    modelResultsToggle.innerHTML = "Model Results " + (open ? "&#9652;" : "&#9662;");
  });

  renderHorizonTabs();
  loadDecisions();
  loadWeights();
  loadBacktestResults();
})();
</script>
</body>
</html>`;
}
