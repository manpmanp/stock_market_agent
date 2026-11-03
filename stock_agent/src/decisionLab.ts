// Primary (and, since the page merge, only rendered) page for the site,
// served at GET /dashboard -- the old /decision-lab URL this was briefly
// also reachable at (and, before that, the one it redirected from) is gone
// entirely now, per explicit instruction to keep only one address
// (see index.ts). Built around the 10-factor decision engine (src/decision/*);
// the TradingView chart, stat row, universe panel, and Growth/Defensive
// section below were carried over from the old watchlist page (dashboard.ts,
// still present but no longer routed to) as part of that merge. v1's own
// scoring computation (src/scoring/score.ts) is untouched and still runs on
// its own schedule as a frozen baseline -- this page's stat row/style badges
// just read its published /rankings output, they don't recompute anything.
// Shares the same color-system tokens as dashboard.ts (same validated
// palette) purely for visual family, not code -- no imports between the two.
//
// This is stock_agent -- the data-driven, self-tuning model selection +
// backtest harness work (formerly tracked as the "v7" folder). Earlier
// manual version-folder snapshots (v1_0 through v1_6, plus the original
// Decision_Algorithm_v0) were removed from the working tree once this
// repo moved to git tags for versioning (see the v0.2.0 tag) -- they're
// still reachable in git history, just not duplicated on disk anymore.
//
// The old "How the algorithm works" / "How weight tuning works" collapsible
// pair, then later a single "Methodology" toggle button hiding a tabbed
// panel, were both replaced by this page's current layout: demo videos
// pinned near the top (first thing a new visitor sees), and a single
// always-visible "Reference & methodology" tab bar further down -- no
// toggle button or hidden panel standing between a visitor and the tabs
// -- covering Factors & Inputs / Glossary / Scoring & Decisions / Weight
// Tuning / Model Selection & Testing / Model Results. Each tab opens with
// a one-paragraph plain-language summary before the technical detail,
// per explicit instruction that the old layout wasn't easy to follow for
// anyone not already familiar with it.
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
    --cat-1:          #2a78d6;
    --cat-2:          #eb6834;
    --cat-3:          #1baf7a;
    --cat-4:          #eda100;
    --cat-5:          #e87ba4;
    --cat-6:          #008300;
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
    /* Growth/Defensive style badge -- carried over from the old watchlist
       page (v1's classifyStyle()), a fixed categorical identity axis kept
       deliberately separate from the good/bad status colors above (see
       dashboard.ts's original comment on this -- reusing a hue between the
       two would make orange mean "Defensive" in one badge and "overvalued"
       in the next). */
    --series-growth:    #2a78d6;
    --series-defensive: #7c5cbf;
    --series-blend:     #898781;
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
      --cat-1:          #3987e5;
      --cat-2:          #d95926;
      --cat-3:          #199e70;
      --cat-4:          #c98500;
      --cat-5:          #d55181;
      --cat-6:          #008300;
      --unscored:       #d9a23a;
      --model-linear:   #3987e5;
      --model-gbm:      #199e70;
      --model-tabpfn:   #9085e9;
      --div-neg: #e66767;
      --div-mid: #383835;
      --div-pos: #3987e5;
      --series-growth:    #3987e5;
      --series-defensive: #9b7fd4;
      --series-blend:     #898781;
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
  .sort-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .sort-bar label { font-size: 12px; color: var(--text-secondary); }
  .sort-bar select { font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-1); color: var(--text-primary); cursor: pointer; }
  /* Stat row + universe panel + Growth/Defensive -- carried over from the
     old watchlist page (dashboard.ts) as part of the page merge. */
  .stat-row { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; min-width: 120px; }
  .stat .v { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat .l { font-size: 11px; color: var(--text-muted); }
  .stat.clickable { cursor: pointer; user-select: none; }
  .stat.clickable .l { display: flex; align-items: center; gap: 3px; }
  .stat.clickable .l .chevron { display: inline-block; font-size: 9px; transition: transform .15s ease; }
  .stat.clickable[aria-expanded="true"] .l .chevron { transform: rotate(180deg); }
  .universe-panel { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 4px 16px; margin: -8px 0 28px; max-width: 560px; }
  .universe-panel[hidden] { display: none; }
  .universe-region { border-bottom: 1px solid var(--gridline); padding: 10px 0; }
  .universe-region:last-child { border-bottom: none; }
  .universe-region-head { display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; font-size: 13px; }
  .universe-region-head .n { font-weight: 600; }
  .universe-region-head .c { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .universe-tickers { display: none; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .universe-tickers.open { display: flex; }
  .universe-tickers span { font-size: 11px; font-variant-numeric: tabular-nums; padding: 2px 7px; border-radius: 6px; background: var(--gridline); color: var(--text-secondary); }
  .style-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 640px) { .style-cols { grid-template-columns: 1fr; } }
  .style-col h3 { font-size: 13px; display: flex; align-items: center; gap: 6px; margin: 0 0 10px; }
  .swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .swatch.growth { background: var(--series-growth); }
  .swatch.defensive { background: var(--series-defensive); }
  .style-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 6px; background: var(--surface-1); font-size: 13px; }
  .style-row .t { font-weight: 600; }
  .style-row .g { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .style-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 999px; color: #fff; white-space: nowrap; }
  .style-badge.growth { background: var(--series-growth); }
  .style-badge.defensive { background: var(--series-defensive); }
  .style-badge.blend { background: var(--series-blend); }
  /* TradingView chart block, per card -- same widget/config as the old
     watchlist page, just wired into this page's DOM-builder (el()) instead
     of dashboard.ts's string templates. */
  .tv-range-row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .tv-range-btn { font: inherit; font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-1); color: var(--text-secondary); cursor: pointer; }
  .tv-range-btn.active { color: #fff; background: var(--seq-400); border-color: var(--seq-400); }
  .tv-widget-container { height: 420px; border-radius: 8px; overflow: hidden; }
  .tv-empty { color: var(--text-muted); font-size: 12px; padding: 44px 0; text-align: center; }
  .tv-credit { font-size: 10px; color: var(--text-muted); margin-top: 4px; }
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
  .methodology-panel { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 36px; }
  .method-section { display: none; }
  .method-section.active { display: block; }
  .method-body { font-size: 13px; color: var(--text-secondary); }
  .method-body h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-muted); margin: 16px 0 8px; }
  .method-body h3:first-child { margin-top: 4px; }
  .method-body h4 { font-size: 12px; color: var(--text-primary); margin: 14px 0 6px; }
  .method-body h4:first-child { margin-top: 0; }
  .method-body p { margin: 0 0 8px; }
  .plain-intro { background: var(--surface-1); border-left: 3px solid var(--seq-400); border-radius: 4px; padding: 10px 14px; margin: 0 0 16px; font-size: 13px; color: var(--text-primary); }
  .demos-section { margin: 18px 0 30px; }
  .demos-section h2 { margin: 0 0 4px; }
  .demo-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 14px; }
  .demo-card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 10px; min-width: 0; }
  .demo-card .demo-title { font-weight: 600; font-size: 12px; margin-bottom: 8px; line-height: 1.35; }
  .demo-card video { width: 100%; border-radius: 8px; border: 1px solid var(--border); background: var(--page); display: block; }
  @media (max-width: 860px) {
    .demo-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 480px) {
    .demo-grid { grid-template-columns: 1fr; }
  }
  .ref-layout { display: flex; gap: 20px; align-items: flex-start; margin-top: 14px; }
  .ref-tabs-vertical { display: flex; flex-direction: column; gap: 6px; flex: 0 0 196px; }
  .ref-tab { display: flex; align-items: center; gap: 10px; text-align: left; padding: 10px 14px 10px 11px; border-radius: 0 10px 10px 0; border: 1px solid var(--border); border-left: 4px solid var(--tab-accent); background: var(--surface-1); color: var(--text-secondary); cursor: pointer; font: inherit; font-size: 13px; font-weight: 500; line-height: 1.25; }
  .ref-tab svg { width: 16px; height: 16px; flex: 0 0 16px; color: var(--tab-accent); }
  .ref-tab[aria-selected="true"] { color: var(--text-primary); font-weight: 700; border-left-width: 7px; background-color: color-mix(in srgb, var(--tab-accent) 14%, var(--surface-1)); }
  .ref-content { flex: 1 1 auto; min-width: 0; }
  @media (max-width: 760px) {
    .ref-layout { flex-direction: column; }
    .ref-tabs-vertical { flex-direction: row; flex-wrap: wrap; flex: initial; width: 100%; }
    .ref-tab { border-left: 1px solid var(--border); border-top: 4px solid var(--tab-accent); border-radius: 8px; }
    .ref-tab[aria-selected="true"] { border-left-width: 1px; border-top-width: 6px; }
  }
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
  <div class="page-header-row">
    <h1>Decision Lab</h1>
  </div>
  <p class="sub">A 10-factor decision engine (quality, growth, financial strength, valuation, future potential, technical, entry, risk, catalyst, market regime). Weights are stored in the database and can be tuned below without redeploying. This build (v7) is also where a data-driven, self-tuning model is being developed and tested -- see Reference &amp; methodology &rarr; Model Selection &amp; Testing below for status. (The original fixed-weight formula this replaced as the primary view still runs untouched in the background as a frozen comparison baseline -- see the same tab.)</p>
  <p class="note">Catalyst has no news/events data source wired in yet, so it's currently a flagged neutral placeholder -- a future version could add one (see Reference &amp; methodology below). Market regime is a real (if simple) live computation from a broad market-index proxy, not this ticker's own data. Data-driven research output, not investment advice.</p>

  <section class="demos-section">
    <h2>See it in action</h2>
    <p class="sub">Four short demos, no sound needed &mdash; captions are burnt into each clip. Start here if this page is new to you.</p>
    <div class="demo-grid">
      <div class="demo-card">
        <div class="demo-title">1. How to read a score (21s)</div>
        <video controls preload="none" poster="data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD/6xaJSlACEQAAAAEAABZ/anVtYgAAAB5qdW1kYzJwYQARABCAAACqADibcQNjMnBhAAAAFllqdW1iAAAAR2p1bWRjMm1hABEAEIAAAKoAOJtxA3VybjpjMnBhOjhjN2YwODNiLTJkZjItNDg1YS1iNzdhLWYzNjhiODcxODM3YwAAAAOUanVtYgAAAClqdW1kYzJhcwARABCAAACqADibcQNjMnBhLmFzc2VydGlvbnMAAAAAuWp1bWIAAABEanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5pbmdyZWRpZW50LnYzAAAAABhjMnNo584cicHfOcdi5eJbv7+zeAAAAG1jYm9yo2lkYzpmb3JtYXRqaW1hZ2UvanBlZ2ppbnN0YW5jZUlEeCx4bXA6aWlkOjlhMDdlNDIxLWJhZTYtNGIxOS1hOWNlLWNjYzIyOTMwOWM4YmxyZWxhdGlvbnNoaXBocGFyZW50T2YAAAHianVtYgAAAEFqdW1kY2JvcgARABCAAACqADibcRNjMnBhLmFjdGlvbnMudjIAAAAAGGMyc2iquoYKAtHjbcD3ZswUXx0RAAABmWNib3KiZ2FjdGlvbnOComZhY3Rpb25rYzJwYS5vcGVuZWRqcGFyYW1ldGVyc6FraW5ncmVkaWVudHOBomN1cmx4LXNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuaW5ncmVkaWVudC52M2RoYXNoWCCuibzkRVS7P2fPlROpMfDHrcbKIEvEoBB5DD0XZ2gPsqRmYWN0aW9ueB1jb20uYW50aHJvcGljLmNsYXVkZS5wcm92aWRlZGpwYXJhbWV0ZXJzoXgfY29tLmFudGhyb3BpYy5vcmlnaW4tY29uZmlkZW5jZWd1bmtub3dua2Rlc2NyaXB0aW9ueGZDbGF1ZGUgcHJvdmlkZWQgdGhpcyBmaWxlIGF0IHRoZSByZXF1ZXN0IG9mIGEgdXNlciBhbmQgbWF5IGhhdmUgY3JlYXRlZCBvciBtb2RpZmllZCB0aGUgZmlsZSBjb250ZW50cy5tc29mdHdhcmVBZ2VudKFkbmFtZWZDbGF1ZGVyYWxsQWN0aW9uc0luY2x1ZGVk9QAAAMhqdW1iAAAAQGp1bWRjYm9yABEAEIAAAKoAOJtxE2MycGEuaGFzaC5kYXRhAAAAABhjMnNo96ZyoJj1ufm0BQawNoWlRwAAAIBjYm9ypWNhbGdmc2hhMjU2Y3BhZE4AAAAAAAAAAAAAAAAAAGRoYXNoWCDspHrmIuPqRuhWbFGEbxsgxyz+XEVItUfMfdty4mOtBGRuYW1lbmp1bWJmIG1hbmlmZXN0amV4Y2x1c2lvbnOBomVzdGFydBRmbGVuZ3RoGRaLAAACPmp1bWIAAAAnanVtZGMyY2wAEQAQgAAAqgA4m3EDYzJwYS5jbGFpbS52MgAAAAIPY2JvcqVjYWxnZnNoYTI1NmlzaWduYXR1cmV4TXNlbGYjanVtYmY9L2MycGEvdXJuOmMycGE6OGM3ZjA4M2ItMmRmMi00ODVhLWI3N2EtZjM2OGI4NzE4MzdjL2MycGEuc2lnbmF0dXJlamluc3RhbmNlSUR4LHhtcDppaWQ6ODM3OWE0ZTYtZWJmYS00NmQ4LTllZmYtNzBlNWM4YzkzYTkzcmNyZWF0ZWRfYXNzZXJ0aW9uc4OiY3VybHgtc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5pbmdyZWRpZW50LnYzZGhhc2hYIK6JvORFVLs/Z8+VE6kx8MetxsogS8SgEHkMPRdnaA+yomN1cmx4KnNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuYWN0aW9ucy52MmRoYXNoWCC3UoSMlX5SqYEVLxNmoAbnFNjgktgp24mYuLAwX27FIqJjdXJseClzZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLmhhc2guZGF0YWRoYXNoWCAycJlmPbe6Mg9hIY4YnKa2dMgQthZH5FauQ8fZicOiZnRjbGFpbV9nZW5lcmF0b3JfaW5mb6NkbmFtZW9BbnRocm9waWMgRmlsZXNndmVyc2lvbmUxLjAuMGtzcGVjVmVyc2lvbmUyLjQuMAAAEDhqdW1iAAAAKGp1bWRjMmNzABEAEIAAAKoAOJtxA2MycGEuc2lnbmF0dXJlAAAAEAhjYm9y0oRZAhKiASYYIVkCCjCCAgYwggGNoAMCAQICFEDloAruwjnQvriD+gZCBT1nVRMAMAoGCCqGSM49BAMDMEkxFzAVBgNVBAoTDkFudGhyb3BpYywgUEJDMS4wLAYDVQQDEyVBbnRocm9waWMgQ29udGVudCBDcmVkZW50aWFscyBSb290IENBMB4XDTI2MDgwNzE4NDM1NloXDTI4MDgwNjE5NDM1NlowRDEXMBUGA1UEChMOQW50aHJvcGljLCBQQkMxKTAnBgNVBAMTIEFudGhyb3BpYyBDbGF1ZGUgQ29udGVudCBTaWduaW5nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmHoKa8tQGAUU1TS9QqU5W0Tp2N3XsvlK7BfQt6YWKwEzd2R3/dzKPEUDdCjlLjp9fT+KFjRVnuZ9v0oXvTe3k6NYMFYwDgYDVR0PAQH/BAQDAgeAMBUGA1UdJQQOMAwGCisGAQQBg+heAgEwDAYDVR0TAQH/BAIwADAfBgNVHSMEGDAWgBTOUeIEgU5kWyP448TPmj6cwddcwjAKBggqhkjOPQQDAwNnADBkAjAxcx0UngF60stVjs5G4T2eiptsBk5mf9oCtfJPAUBl8qs/PEXa8+gk1/X5QJ2DVcYCMHBfXN31YapiSqYvlIWrDVDJKOvXMl+kkz37Wt0PBI8sw486Mq6JeOhT+lRR4b1HCaFjcGFkWQ2eAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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" src="/assets/demos/1_how_to_read_a_score.mp4"></video>
      </div>
      <div class="demo-card">
        <div class="demo-title">2. What creates the scoring (27s)</div>
        <video controls preload="none" poster="data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD/6xaJSlACEQAAAAEAABZ/anVtYgAAAB5qdW1kYzJwYQARABCAAACqADibcQNjMnBhAAAAFllqdW1iAAAAR2p1bWRjMm1hABEAEIAAAKoAOJtxA3VybjpjMnBhOjM4NTI2NmExLWJjYWUtNGUxYS04OGRmLTU4NTFiODM1NmZkYgAAAAOUanVtYgAAAClqdW1kYzJhcwARABCAAACqADibcQNjMnBhLmFzc2VydGlvbnMAAAAAuWp1bWIAAABEanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5pbmdyZWRpZW50LnYzAAAAABhjMnNotsw/vX2CZWQ3fdx/Ev2pcwAAAG1jYm9yo2lkYzpmb3JtYXRqaW1hZ2UvanBlZ2ppbnN0YW5jZUlEeCx4bXA6aWlkOmY0OGFiYzJjLTZiODMtNDYzOS1hYTg3LWY2NGI2NGIyNGE4YmxyZWxhdGlvbnNoaXBocGFyZW50T2YAAAHianVtYgAAAEFqdW1kY2JvcgARABCAAACqADibcRNjMnBhLmFjdGlvbnMudjIAAAAAGGMyc2gOFN7xtjrwgFbcCXDb5mIJAAABmWNib3KiZ2FjdGlvbnOComZhY3Rpb25rYzJwYS5vcGVuZWRqcGFyYW1ldGVyc6FraW5ncmVkaWVudHOBomN1cmx4LXNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuaW5ncmVkaWVudC52M2RoYXNoWCBi/FT+wFUyKaEGaH8AZg8wXSgJJzYc2x2CMNFHxphd+6RmYWN0aW9ueB1jb20uYW50aHJvcGljLmNsYXVkZS5wcm92aWRlZGpwYXJhbWV0ZXJzoXgfY29tLmFudGhyb3BpYy5vcmlnaW4tY29uZmlkZW5jZWd1bmtub3dua2Rlc2NyaXB0aW9ueGZDbGF1ZGUgcHJvdmlkZWQgdGhpcyBmaWxlIGF0IHRoZSByZXF1ZXN0IG9mIGEgdXNlciBhbmQgbWF5IGhhdmUgY3JlYXRlZCBvciBtb2RpZmllZCB0aGUgZmlsZSBjb250ZW50cy5tc29mdHdhcmVBZ2VudKFkbmFtZWZDbGF1ZGVyYWxsQWN0aW9uc0luY2x1ZGVk9QAAAMhqdW1iAAAAQGp1bWRjYm9yABEAEIAAAKoAOJtxE2MycGEuaGFzaC5kYXRhAAAAABhjMnNogR9GNs5QO5l+qvdF/pOA0wAAAIBjYm9ypWNhbGdmc2hhMjU2Y3BhZE4AAAAAAAAAAAAAAAAAAGRoYXNoWCADnmxtdiW64owDxEMaEIBIC3n61g28WITgoQJVqmWVaWRuYW1lbmp1bWJmIG1hbmlmZXN0amV4Y2x1c2lvbnOBomVzdGFydBRmbGVuZ3RoGRaLAAACPmp1bWIAAAAnanVtZGMyY2wAEQAQgAAAqgA4m3EDYzJwYS5jbGFpbS52MgAAAAIPY2JvcqVjYWxnZnNoYTI1NmlzaWduYXR1cmV4TXNlbGYjanVtYmY9L2MycGEvdXJuOmMycGE6Mzg1MjY2YTEtYmNhZS00ZTFhLTg4ZGYtNTg1MWI4MzU2ZmRiL2MycGEuc2lnbmF0dXJlamluc3RhbmNlSUR4LHhtcDppaWQ6YzQyNzhhNjYtNDVmOS00ZGJmLWFhZDMtZDAwMGUwYWJiMjIzcmNyZWF0ZWRfYXNzZXJ0aW9uc4OiY3VybHgtc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5pbmdyZWRpZW50LnYzZGhhc2hYIGL8VP7AVTIpoQZofwBmDzBdKAknNhzbHYIw0UfGmF37omN1cmx4KnNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuYWN0aW9ucy52MmRoYXNoWCA681EE3zNLYT0F2oudwL85RmbrYhdvrkUFID89iv9ov6JjdXJseClzZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLmhhc2guZGF0YWRoYXNoWCDPC22JrruK+fAqt4nBcRhZ6e2VsFlbA1XUkmvfvntPQXRjbGFpbV9nZW5lcmF0b3JfaW5mb6NkbmFtZW9BbnRocm9waWMgRmlsZXNndmVyc2lvbmUxLjAuMGtzcGVjVmVyc2lvbmUyLjQuMAAAEDhqdW1iAAAAKGp1bWRjMmNzABEAEIAAAKoAOJtxA2MycGEuc2lnbmF0dXJlAAAAEAhjYm9y0oRZAhKiASYYIVkCCjCCAgYwggGNoAMCAQICFEDloAruwjnQvriD+gZCBT1nVRMAMAoGCCqGSM49BAMDMEkxFzAVBgNVBAoTDkFudGhyb3BpYywgUEJDMS4wLAYDVQQDEyVBbnRocm9waWMgQ29udGVudCBDcmVkZW50aWFscyBSb290IENBMB4XDTI2MDgwNzE4NDM1NloXDTI4MDgwNjE5NDM1NlowRDEXMBUGA1UEChMOQW50aHJvcGljLCBQQkMxKTAnBgNVBAMTIEFudGhyb3BpYyBDbGF1ZGUgQ29udGVudCBTaWduaW5nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmHoKa8tQGAUU1TS9QqU5W0Tp2N3XsvlK7BfQt6YWKwEzd2R3/dzKPEUDdCjlLjp9fT+KFjRVnuZ9v0oXvTe3k6NYMFYwDgYDVR0PAQH/BAQDAgeAMBUGA1UdJQQOMAwGCisGAQQBg+heAgEwDAYDVR0TAQH/BAIwADAfBgNVHSMEGDAWgBTOUeIEgU5kWyP448TPmj6cwddcwjAKBggqhkjOPQQDAwNnADBkAjAxcx0UngF60stVjs5G4T2eiptsBk5mf9oCtfJPAUBl8qs/PEXa8+gk1/X5QJ2DVcYCMHBfXN31YapiSqYvlIWrDVDJKOvXMl+kkz37Wt0PBI8sw486Mq6JeOhT+lRR4b1HCaFjcGFkWQ2eAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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" src="/assets/demos/2_what_creates_the_scoring.mp4"></video>
      </div>
      <div class="demo-card">
        <div class="demo-title">3. What to do (20s)</div>
        <video controls preload="none" poster="data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD/6xaJSlACEQAAAAEAABZ/anVtYgAAAB5qdW1kYzJwYQARABCAAACqADibcQNjMnBhAAAAFllqdW1iAAAAR2p1bWRjMm1hABEAEIAAAKoAOJtxA3VybjpjMnBhOjA4OGUxNDFhLTQyY2MtNDg1Mi1iOGIwLTQ0NTgwNzQzMDFjNQAAAAOUanVtYgAAAClqdW1kYzJhcwARABCAAACqADibcQNjMnBhLmFzc2VydGlvbnMAAAAAuWp1bWIAAABEanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5pbmdyZWRpZW50LnYzAAAAABhjMnNo/0vImWOYL4CLwg/1uoonIAAAAG1jYm9yo2lkYzpmb3JtYXRqaW1hZ2UvanBlZ2ppbnN0YW5jZUlEeCx4bXA6aWlkOmQ2NjRmMDVhLWZlNTUtNDE4ZS1iYjlmLTRkM2RhYjhjZDY1NmxyZWxhdGlvbnNoaXBocGFyZW50T2YAAAHianVtYgAAAEFqdW1kY2JvcgARABCAAACqADibcRNjMnBhLmFjdGlvbnMudjIAAAAAGGMyc2i5EQzQ3qJvEkhM3zV8iKFbAAABmWNib3KiZ2FjdGlvbnOComZhY3Rpb25rYzJwYS5vcGVuZWRqcGFyYW1ldGVyc6FraW5ncmVkaWVudHOBomN1cmx4LXNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuaW5ncmVkaWVudC52M2RoYXNoWCCiZFmuZ6cKFeLsRsFuHBE13OIX/Tz9PcAuCpWWGRXpKaRmYWN0aW9ueB1jb20uYW50aHJvcGljLmNsYXVkZS5wcm92aWRlZGpwYXJhbWV0ZXJzoXgfY29tLmFudGhyb3BpYy5vcmlnaW4tY29uZmlkZW5jZWd1bmtub3dua2Rlc2NyaXB0aW9ueGZDbGF1ZGUgcHJvdmlkZWQgdGhpcyBmaWxlIGF0IHRoZSByZXF1ZXN0IG9mIGEgdXNlciBhbmQgbWF5IGhhdmUgY3JlYXRlZCBvciBtb2RpZmllZCB0aGUgZmlsZSBjb250ZW50cy5tc29mdHdhcmVBZ2VudKFkbmFtZWZDbGF1ZGVyYWxsQWN0aW9uc0luY2x1ZGVk9QAAAMhqdW1iAAAAQGp1bWRjYm9yABEAEIAAAKoAOJtxE2MycGEuaGFzaC5kYXRhAAAAABhjMnNoEXD5H2qZttEtlX31PzrKAwAAAIBjYm9ypWNhbGdmc2hhMjU2Y3BhZE4AAAAAAAAAAAAAAAAAAGRoYXNoWCDGAbjaUfQMRfCdytQYVbUxcJ3w70UOB1gvFIZdiAqgMGRuYW1lbmp1bWJmIG1hbmlmZXN0amV4Y2x1c2lvbnOBomVzdGFydBRmbGVuZ3RoGRaLAAACPmp1bWIAAAAnanVtZGMyY2wAEQAQgAAAqgA4m3EDYzJwYS5jbGFpbS52MgAAAAIPY2JvcqVjYWxnZnNoYTI1NmlzaWduYXR1cmV4TXNlbGYjanVtYmY9L2MycGEvdXJuOmMycGE6MDg4ZTE0MWEtNDJjYy00ODUyLWI4YjAtNDQ1ODA3NDMwMWM1L2MycGEuc2lnbmF0dXJlamluc3RhbmNlSUR4LHhtcDppaWQ6N2M3Zjk4ZGYtODc2Yi00MGEyLWIxOTUtNDczMWRiZGNjZTYwcmNyZWF0ZWRfYXNzZXJ0aW9uc4OiY3VybHgtc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5pbmdyZWRpZW50LnYzZGhhc2hYIKJkWa5npwoV4uxGwW4cETXc4hf9PP09wC4KlZYZFekpomN1cmx4KnNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuYWN0aW9ucy52MmRoYXNoWCDC57oiANRyK2f2iKrI2yAhSiSplEbDQIgFVwTk0RkyY6JjdXJseClzZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLmhhc2guZGF0YWRoYXNoWCCwyPgvxJj9K8SezfD5MSN4ldP/EOU/A9H5BNw4NbeyG3RjbGFpbV9nZW5lcmF0b3JfaW5mb6NkbmFtZW9BbnRocm9waWMgRmlsZXNndmVyc2lvbmUxLjAuMGtzcGVjVmVyc2lvbmUyLjQuMAAAEDhqdW1iAAAAKGp1bWRjMmNzABEAEIAAAKoAOJtxA2MycGEuc2lnbmF0dXJlAAAAEAhjYm9y0oRZAhKiASYYIVkCCjCCAgYwggGNoAMCAQICFEDloAruwjnQvriD+gZCBT1nVRMAMAoGCCqGSM49BAMDMEkxFzAVBgNVBAoTDkFudGhyb3BpYywgUEJDMS4wLAYDVQQDEyVBbnRocm9waWMgQ29udGVudCBDcmVkZW50aWFscyBSb290IENBMB4XDTI2MDgwNzE4NDM1NloXDTI4MDgwNjE5NDM1NlowRDEXMBUGA1UEChMOQW50aHJvcGljLCBQQkMxKTAnBgNVBAMTIEFudGhyb3BpYyBDbGF1ZGUgQ29udGVudCBTaWduaW5nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmHoKa8tQGAUU1TS9QqU5W0Tp2N3XsvlK7BfQt6YWKwEzd2R3/dzKPEUDdCjlLjp9fT+KFjRVnuZ9v0oXvTe3k6NYMFYwDgYDVR0PAQH/BAQDAgeAMBUGA1UdJQQOMAwGCisGAQQBg+heAgEwDAYDVR0TAQH/BAIwADAfBgNVHSMEGDAWgBTOUeIEgU5kWyP448TPmj6cwddcwjAKBggqhkjOPQQDAwNnADBkAjAxcx0UngF60stVjs5G4T2eiptsBk5mf9oCtfJPAUBl8qs/PEXa8+gk1/X5QJ2DVcYCMHBfXN31YapiSqYvlIWrDVDJKOvXMl+kkz37Wt0PBI8sw486Mq6JeOhT+lRR4b1HCaFjcGFkWQ2eAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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" src="/assets/demos/3_what_to_do.mp4"></video>
      </div>
      <div class="demo-card">
        <div class="demo-title">4. The agentic layer &mdash; POST /market-analysis (30s)</div>
        <video controls preload="none" poster="data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD/6xaJSlACEQAAAAEAABZ/anVtYgAAAB5qdW1kYzJwYQARABCAAACqADibcQNjMnBhAAAAFllqdW1iAAAAR2p1bWRjMm1hABEAEIAAAKoAOJtxA3VybjpjMnBhOjNjZTlmMWVjLTIzZmUtNDAyZC1hM2VlLWFhYzVhNmQzY2RkNQAAAAOUanVtYgAAAClqdW1kYzJhcwARABCAAACqADibcQNjMnBhLmFzc2VydGlvbnMAAAAAuWp1bWIAAABEanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5pbmdyZWRpZW50LnYzAAAAABhjMnNo2DxCrh4ED7qKfFe7RHMLUwAAAG1jYm9yo2lkYzpmb3JtYXRqaW1hZ2UvanBlZ2ppbnN0YW5jZUlEeCx4bXA6aWlkOjEzMjFhZGQ0LTQ5ODktNDdiOS1iNDRmLTQwNWIxY2ZkNDg4ZmxyZWxhdGlvbnNoaXBocGFyZW50T2YAAAHianVtYgAAAEFqdW1kY2JvcgARABCAAACqADibcRNjMnBhLmFjdGlvbnMudjIAAAAAGGMyc2jQ4yEKOvyibSMWFuJiqIb1AAABmWNib3KiZ2FjdGlvbnOComZhY3Rpb25rYzJwYS5vcGVuZWRqcGFyYW1ldGVyc6FraW5ncmVkaWVudHOBomN1cmx4LXNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuaW5ncmVkaWVudC52M2RoYXNoWCBExidt3Qxfv2kZUz0F4INVolvmZ00KwXgLu2S5v7DeqKRmYWN0aW9ueB1jb20uYW50aHJvcGljLmNsYXVkZS5wcm92aWRlZGpwYXJhbWV0ZXJzoXgfY29tLmFudGhyb3BpYy5vcmlnaW4tY29uZmlkZW5jZWd1bmtub3dua2Rlc2NyaXB0aW9ueGZDbGF1ZGUgcHJvdmlkZWQgdGhpcyBmaWxlIGF0IHRoZSByZXF1ZXN0IG9mIGEgdXNlciBhbmQgbWF5IGhhdmUgY3JlYXRlZCBvciBtb2RpZmllZCB0aGUgZmlsZSBjb250ZW50cy5tc29mdHdhcmVBZ2VudKFkbmFtZWZDbGF1ZGVyYWxsQWN0aW9uc0luY2x1ZGVk9QAAAMhqdW1iAAAAQGp1bWRjYm9yABEAEIAAAKoAOJtxE2MycGEuaGFzaC5kYXRhAAAAABhjMnNoBKexT0boO7JOdPAQ8oODNwAAAIBjYm9ypWNhbGdmc2hhMjU2Y3BhZE4AAAAAAAAAAAAAAAAAAGRoYXNoWCBiD0WC8Yl/35ovhPcJFd6dQ4fnBJbCGsrjEZ2xF0zAo2RuYW1lbmp1bWJmIG1hbmlmZXN0amV4Y2x1c2lvbnOBomVzdGFydBRmbGVuZ3RoGRaLAAACPmp1bWIAAAAnanVtZGMyY2wAEQAQgAAAqgA4m3EDYzJwYS5jbGFpbS52MgAAAAIPY2JvcqVjYWxnZnNoYTI1NmlzaWduYXR1cmV4TXNlbGYjanVtYmY9L2MycGEvdXJuOmMycGE6M2NlOWYxZWMtMjNmZS00MDJkLWEzZWUtYWFjNWE2ZDNjZGQ1L2MycGEuc2lnbmF0dXJlamluc3RhbmNlSUR4LHhtcDppaWQ6MGFkMmRhZGMtZTUyMS00NGJlLWJlZWQtOGY3OGZiYmFlYTBkcmNyZWF0ZWRfYXNzZXJ0aW9uc4OiY3VybHgtc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5pbmdyZWRpZW50LnYzZGhhc2hYIETGJ23dDF+/aRlTPQXgg1WiW+ZnTQrBeAu7ZLm/sN6oomN1cmx4KnNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuYWN0aW9ucy52MmRoYXNoWCCxqmF9UKdFG0Ty7/GYQftery2HNjPNN82GhY8/DUV6mqJjdXJseClzZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLmhhc2guZGF0YWRoYXNoWCBhRXnmasMN4ThMjl/A1JPljjcdA79tW7WpzcglcFboPXRjbGFpbV9nZW5lcmF0b3JfaW5mb6NkbmFtZW9BbnRocm9waWMgRmlsZXNndmVyc2lvbmUxLjAuMGtzcGVjVmVyc2lvbmUyLjQuMAAAEDhqdW1iAAAAKGp1bWRjMmNzABEAEIAAAKoAOJtxA2MycGEuc2lnbmF0dXJlAAAAEAhjYm9y0oRZAhKiASYYIVkCCjCCAgYwggGNoAMCAQICFEDloAruwjnQvriD+gZCBT1nVRMAMAoGCCqGSM49BAMDMEkxFzAVBgNVBAoTDkFudGhyb3BpYywgUEJDMS4wLAYDVQQDEyVBbnRocm9waWMgQ29udGVudCBDcmVkZW50aWFscyBSb290IENBMB4XDTI2MDgwNzE4NDM1NloXDTI4MDgwNjE5NDM1NlowRDEXMBUGA1UEChMOQW50aHJvcGljLCBQQkMxKTAnBgNVBAMTIEFudGhyb3BpYyBDbGF1ZGUgQ29udGVudCBTaWduaW5nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmHoKa8tQGAUU1TS9QqU5W0Tp2N3XsvlK7BfQt6YWKwEzd2R3/dzKPEUDdCjlLjp9fT+KFjRVnuZ9v0oXvTe3k6NYMFYwDgYDVR0PAQH/BAQDAgeAMBUGA1UdJQQOMAwGCisGAQQBg+heAgEwDAYDVR0TAQH/BAIwADAfBgNVHSMEGDAWgBTOUeIEgU5kWyP448TPmj6cwddcwjAKBggqhkjOPQQDAwNnADBkAjAxcx0UngF60stVjs5G4T2eiptsBk5mf9oCtfJPAUBl8qs/PEXa8+gk1/X5QJ2DVcYCMHBfXN31YapiSqYvlIWrDVDJKOvXMl+kkz37Wt0PBI8sw486Mq6JeOhT+lRR4b1HCaFjcGFkWQ2eAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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" src="/assets/demos/4_the_agentic_layer.mp4"></video>
      </div>
    </div>
    <p class="note">If a video shows a broken-link icon instead of playing, the R2 asset bucket hasn't been set up/uploaded to yet on this deploy &mdash; see README "Demo videos".</p>
  </section>

  <div class="stat-row" id="stats"></div>
  <div class="universe-panel" id="universePanel" hidden></div>

  <section id="reference-panel" class="methodology-panel">
    <h2>Reference &amp; methodology</h2>
    <p class="sub">How the scoring actually works, in as much depth as you want &mdash; pick a tab.</p>
    <div class="ref-layout">
      <div class="ref-tabs-vertical" id="method-tabs" role="tablist">
        <button class="tab ref-tab" role="tab" data-section="factors" aria-selected="true" style="--tab-accent:var(--cat-1)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1"></rect><rect x="9" y="1.5" width="5.5" height="5.5" rx="1"></rect><rect x="1.5" y="9" width="5.5" height="5.5" rx="1"></rect><rect x="9" y="9" width="5.5" height="5.5" rx="1"></rect></svg><span>Factors &amp; Inputs</span></button>
        <button class="tab ref-tab" role="tab" data-section="glossary" aria-selected="false" style="--tab-accent:var(--cat-2)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2 2.5h4.5a2 2 0 0 1 2 2V14a1.5 1.5 0 0 0-1.5-1.5H2z"></path><path d="M14 2.5H9.5a2 2 0 0 0-2 2V14a1.5 1.5 0 0 1 1.5-1.5H14z"></path></svg><span>Glossary</span></button>
        <button class="tab ref-tab" role="tab" data-section="scoring" aria-selected="false" style="--tab-accent:var(--cat-3)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.3"></circle><path d="M5.3 8.2l1.9 1.9 3.5-4"></path></svg><span>Scoring &amp; Decisions</span></button>
        <button class="tab ref-tab" role="tab" data-section="tuning" aria-selected="false" style="--tab-accent:var(--cat-4)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="3" y1="2" x2="3" y2="14"></line><circle cx="3" cy="6" r="1.6" fill="currentColor" stroke="none"></circle><line x1="8" y1="2" x2="8" y2="14"></line><circle cx="8" cy="10" r="1.6" fill="currentColor" stroke="none"></circle><line x1="13" y1="2" x2="13" y2="14"></line><circle cx="13" cy="5" r="1.6" fill="currentColor" stroke="none"></circle></svg><span>Weight Tuning</span></button>
        <button class="tab ref-tab" role="tab" data-section="model" aria-selected="false" style="--tab-accent:var(--cat-5)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M6.3 1.8h3.4"></path><path d="M6.8 2v3.8L2.9 12a1.4 1.4 0 0 0 1.2 2.1h7.8a1.4 1.4 0 0 0 1.2-2.1L9.2 5.8V2"></path><path d="M4.6 10.2h6.8"></path></svg><span>Model Selection &amp; Testing</span></button>
        <button class="tab ref-tab" role="tab" data-section="results" aria-selected="false" style="--tab-accent:var(--cat-6)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="14" x2="14" y2="14"></line><rect x="3" y="8.5" width="2.6" height="5.2" rx="0.4" fill="currentColor" stroke="none"></rect><rect x="6.8" y="5" width="2.6" height="8.7" rx="0.4" fill="currentColor" stroke="none"></rect><rect x="10.6" y="2.5" width="2.6" height="11.2" rx="0.4" fill="currentColor" stroke="none"></rect></svg><span>Model Results</span></button>
      </div>
      <div class="ref-content">

    <div class="method-section active" data-section="factors">
      <div class="method-body">
        <p class="plain-intro">In plain terms: every stock gets scored 0-100 on ten different questions &mdash; is it a profitable business, is it growing, could it survive a downturn, is it fairly priced, and so on. Each factor below covers one of those questions and lists exactly what financial data feeds it.</p>
        <h3>The 10 factors</h3>
        <p>Every ticker gets a 0-100 score on each of 10 factors, each meant to answer a different question:</p>
        <table>
          <tr><th>Factor</th><th>What feeds it</th></tr>
          <tr><td>Quality</td><td>Gross margin, operating margin, net margin, return on equity (ROE), return on assets (ROA) -- is this a good business</td></tr>
          <tr><td>Growth</td><td>Revenue growth (YoY), earnings growth (YoY)</td></tr>
          <tr><td>Financial strength</td><td>Debt-to-equity, free cash flow (FCF) yield, Net Debt/EBITDA, interest coverage -- can it weather a downturn</td></tr>
          <tr><td>Valuation</td><td>Where price sits in its own ~5y range, the gap vs. analyst fair value, plus EV/EBITDA and Price/Book as absolute cross-checks against those two self-relative reads (EV/EBIT is shown as a display-only metric, not blended in here -- its ebit input is already scored once, in Financial Strength)</td></tr>
          <tr><td>Future potential</td><td>A proxy (PEG ratio + sell-side analyst consensus, confidence-modulated by coverage breadth) for growth-adjusted upside -- not a real TAM/runway estimate, no data source for that exists</td></tr>
          <tr><td>Technical</td><td>RSI (14-day), MACD vs. its signal line, price vs. 50-day average, price vs. 200-day average -- see the Glossary tab for what each one means and how to read the numbers</td></tr>
          <tr><td>Entry</td><td>This ticker's own trend-state read (pullback in an uptrend / near highs / downtrend / neutral) -- is right now, specifically, a reasonable point to buy. RSI isn't blended in separately here: it's already scored in Technical, and trend-state itself already uses RSI internally to help classify a pullback</td></tr>
          <tr><td>Risk</td><td>30-day volatility, distance from this ticker's own high, Beta -- higher score = lower risk. Debt-to-equity isn't blended in separately here: leverage is already scored once, in Financial Strength</td></tr>
          <tr><td>Catalyst</td><td>Currently a flagged neutral placeholder (50) in this version -- no news/events data source is wired in yet (planned for a future version, not this one)</td></tr>
          <tr><td>Market regime</td><td>One shared reading per run, from a market-index proxy's (SPY) own trend -- not this ticker's own data, so it moves every ticker together, not against each other</td></tr>
        </table>
        <p class="note">P/E, EV/EBIT, and payout ratio are shown on each card as supporting metrics but aren't blended into any factor score -- EV/EBIT in particular used to feed Valuation directly but was removed from scoring (kept display-only) as part of a raw-input collinearity fix: its ebit input is already scored once, via Financial Strength's interest-coverage read, and double-counting it into Valuation too inflated the correlation between those two factors beyond what real signal justified. The same fix removed debt-to-equity from Risk (kept in Financial Strength only) and RSI from Entry (kept in Technical only; trend-state, which Entry does use, already incorporates RSI internally). EV/EBITDA and Price/Book now feed Valuation, and the analyst recommendation breakdown now feeds Future Potential (see the rows above) -- only the price-target range itself remains a display-only cross-check. See "Valuation & balance-sheet multiples" and "Analyst data" on the decision cards below.</p>
      </div>
    </div>

    <div class="method-section" data-section="glossary">
      <div class="method-body">
        <p class="plain-intro">Short, plain-English definitions for every technical or financial term used elsewhere on this page (RSI, PEG, EV/EBITDA, and so on) &mdash; useful if a term on a decision card or in the Factors tab isn't familiar.</p>
        <p>What each technical or financial term means, and how this engine specifically reads the number -- grouped by what kind of read it feeds.</p>
        <h4>Momentum &amp; trend (feeds Technical, Entry, Risk)</h4>
        <div class="term-row">
          <div class="term-name">RSI <span class="term-full">Relative Strength Index (14-day)</span></div>
          <div class="term-def">Momentum oscillator from 0-100, based on the size of recent up-moves vs. down-moves. Textbook reading: above 70 is "overbought," below 30 is "oversold." This engine's Technical factor doesn't use that reading directly -- it scores <i>highest</i> at RSI 50 (neutral) and lower the further RSI drifts toward either extreme, treating a big swing either way as reduced momentum-signal confidence rather than a buy/sell trigger on its own. Feeds Technical only: it no longer also feeds Entry directly (that was a raw-input collinearity fix), though RSI still shapes Entry indirectly, since trend-state itself uses RSI as part of how it classifies a pullback.</div>
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
          <div class="term-def">Enterprise value (market cap + debt &minus; cash -- what it would cost to buy the whole company, debt included) divided by EBIT (operating profit, before interest and tax). Unlike P/E, it isn't distorted by capital structure (how much debt a company carries) or tax rate, so it's a cleaner apples-to-apples multiple across companies. Shown raw next to P/E on each card as a display-only cross-check, but does NOT feed the Valuation factor's score: its ebit input is already scored once, via Financial Strength's interest-coverage read, and blending it into Valuation too would double-count that one input across two factors (a raw-input collinearity fix).</div>
        </div>
        <div class="term-row">
          <div class="term-name">EV/EBITDA <span class="term-full">Enterprise Value / EBITDA</span></div>
          <div class="term-def">Same idea as EV/EBIT, but against EBITDA (operating profit before interest, tax, depreciation, and amortization) instead of EBIT -- so it also strips out the effect of how much a company depreciates its assets. Pulled from Yahoo Finance directly (not derived here) -- this engine treats roughly 6x as cheap and 18x+ as expensive. Feeds the Valuation factor alongside Price/Book, as part of the absolute-multiple composite (see below) -- unlike EV/EBIT, it doesn't share a raw input with any other factor, so it's safe to score here; also shown raw next to EV/EBIT on each card.</div>
        </div>
        <div class="term-row">
          <div class="term-name">Price/Book <span class="term-full">P/B ratio</span></div>
          <div class="term-def">Share price divided by book value per share (shareholders' equity per share) -- what you're paying relative to the accounting value of the company's net assets. Most informative for asset-heavy or financial businesses, where EV/EBIT(DA) can be noisy off thin or volatile operating income -- this engine treats roughly 1x as cheap and 5x+ as expensive. Feeds the Valuation factor alongside EV/EBITDA: the two are averaged together into one "cheap by an absolute yardstick" composite (they're substitutable evidence for the same question), then that composite is weighed against the self-relative signals (own price range, gap vs. analyst fair value) with conflict-awareness.</div>
        </div>
        <div class="term-row">
          <div class="term-name">Net Debt/EBITDA</div>
          <div class="term-def">(Total debt &minus; total cash) divided by EBITDA -- how many years of current cash-flow generation it would take to pay off all debt, net of cash on hand. Lower is safer; it can go negative (a "net cash" position, meaning cash on hand exceeds debt), which reads as very strong here. This engine treats ~0x or negative as strong and ~4x+ as stretched. Feeds Financial Strength alongside debt-to-equity, FCF yield, and interest coverage.</div>
        </div>
        <div class="term-row">
          <div class="term-name">Interest coverage <span class="term-full">EBIT / Interest expense</span></div>
          <div class="term-def">How many times over a company's operating profit could cover its interest payments -- a direct read on debt-servicing safety, distinct from leverage ratios (which measure how much debt exists, not whether it's being paid comfortably). Below ~2x is a red flag, above ~8x is comfortable. Feeds Financial Strength.</div>
        </div>
        <div class="term-row">
          <div class="term-name">Debt-to-equity <span class="term-full">D/E ratio</span></div>
          <div class="term-def">Total debt divided by shareholder equity -- how leveraged the company is. Lower is generally safer. Feeds Financial Strength only here -- it used to also feed Risk, but leverage is now scored once rather than duplicated across both factors (a raw-input collinearity fix).</div>
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
        <h4>Analyst data</h4>
        <div class="term-row">
          <div class="term-name">Analyst recommendations <span class="term-full">strong buy / buy / hold / sell / strong sell breakdown</span></div>
          <div class="term-def">The current breakdown of sell-side analyst ratings from Yahoo Finance, converted to a 0-100 consensus score (count-weighted: strong buy=100, buy=75, hold=50, sell=25, strong sell=0) and blended into Future Potential alongside PEG, with conflict-awareness between the two reads and a hard cap when a well-covered (3+ analyst) consensus is net sell-leaning -- see the Future Potential row above. When the count breakdown isn't available, falls back to Yahoo's single textual rating (e.g. "buy", "strong_sell"), mapped onto the same 0-100 scale.</div>
        </div>
        <div class="term-row">
          <div class="term-name">Price targets</div>
          <div class="term-def">Low/mean/high 12-month analyst price targets, also from Yahoo Finance. Shown as a cross-check on each card -- other analysts' independent view of where the price might go, not an input to any factor score.</div>
        </div>
      </div>
    </div>

    <div class="method-section" data-section="scoring">
      <div class="method-body">
        <p class="plain-intro">Short version: each factor's 0-100 score gets multiplied by its weight and added up into one final number, which maps onto a label like BUY or HOLD. "Confidence" is a separate measure of how much the ten factors agree with each other, not part of that final number.</p>
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
        <p class="plain-intro">This is where you can change how much each factor counts, per time horizon, without touching any code. Read the recommended process below before changing anything &mdash; these starting weights haven't been backtested yet.</p>
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
        <p class="plain-intro">Separate from the live scoring above, an experimental system is being built and tested here that would learn the weighting from real outcomes instead of having it typed in by hand. Nothing from it is live yet &mdash; see the status callout below for what's actually running today.</p>
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
          <b>What is selected today:</b> nothing yet -- the backtest harness runs and its results are published (see the "Model Results" tab above), but nothing from it is wired into live scoring. Live decisions on this page still use the hand-set weights in the Weight Tuning tab. A model only gets adopted here once it beats the linear baseline by a real, statistically-checked margin -- see Model Results for whether that's happened yet.
        </div>
        <h3>Known limits</h3>
        <p>This backtest is only fully honest for the technical/price-based factors, which have genuine point-in-time history going back 5 years. Fundamentals-driven factors (quality, valuation, etc.) don't have point-in-time history available at this project's current data budget -- their outcomes accrue live, going forward, rather than from backtesting, and the model won't be extended to lean on them until that live history exists. Catalyst/news-based scoring (e.g. via an LLM reading filings or news) was considered and deliberately deferred to a future version -- out of scope here.</p>
      </div>
    </div>
    <div class="method-section" data-section="results">
      <div class="method-body">
        <p class="plain-intro">The experimental model from the "Model Selection &amp; Testing" tab is actually being tested on real historical data; this tab shows the real output from the last test run, not just the plan.</p>
        <h3>Model Results</h3>
        <p>Actual output from the last time <code>scripts/backtest.sh</code> ran on your machine -- the same walk-forward comparison described in Model Selection &amp; Testing, but the real numbers instead of the plan. Per horizon: comparison metrics, then the automatic hyperparameter tuning record (what got chosen per fold, and why that can change fold to fold), then three interpretability views -- feature importance (what each model leaned on), feature/label correlations (how the raw technical inputs relate to each other and to actual outcomes), and partial dependence (each input's own learned effect). This covers the technical/price-based features only, not the full 10-factor decision engine -- see Model Selection &amp; Testing's "Known limits" for why. Nothing here changes live decisions by itself (see the status callout there); this is the evidence you'd need before it did.</p>
        <div id="model-results-content"><div class="empty">Loading&hellip;</div></div>
      </div>
    </div>

      </div>
    </div>
  </section>

  <section>
    <h2>Decisions</h2>
    <p class="note" style="margin-bottom: 14px;">Each card's <b>Decision</b> badge is the weighted average of all 10 factors (see Reference &amp; methodology below). Its <b>Entry</b> and <b>Valuation</b> readings next to it are each just one factor's own score, shown separately on purpose -- they can disagree with the overall Decision, and with each other. A weak entry timing can still sit inside a Buy (the other 9 factors carried it); a good entry can still sit inside an Accumulate (something else pulled the average down). Sort/rank always follows the overall score, not either of these two.</p>
    <div class="tabs" id="horizon-tabs" role="tablist"></div>
    <div class="sort-bar">
      <label for="sort-select">Sort by</label>
      <select id="sort-select">
        <option value="score-desc">Score: high to low</option>
        <option value="score-asc">Score: low to high</option>
        <option value="entry-desc">Entry: best to worst (then score)</option>
        <option value="entry-asc">Entry: worst to best (then score)</option>
        <option value="decision-desc">Decision: best to worst (then score)</option>
        <option value="decision-asc">Decision: worst to best (then score)</option>
        <option value="valuation-desc">Valuation: best to worst (then score)</option>
        <option value="valuation-asc">Valuation: worst to best (then score)</option>
        <option value="combined-desc">Combined (entry + decision + valuation): best to worst</option>
        <option value="combined-asc">Combined (entry + decision + valuation): worst to best</option>
      </select>
    </div>
    <div class="run-at" id="run-at"></div>
    <div id="decisions-list"></div>
  </section>

  <section>
    <h2>Growth <span class="swatch growth"></span> vs Defensive <span class="swatch defensive"></span></h2>
    <p class="note" style="margin-bottom: 14px;">
      A style label, not a ranking: fixed thresholds on each stock's own revenue/earnings growth,
      dividend yield, and volatility -- never compared to the rest of the universe. "Blend" means
      neither signal clears the threshold. This is v1's own classification (see
      <code>src/scoring/score.ts classifyStyle()</code>) shown here for reference; it isn't part of
      the Decision Lab's 10-factor score above.
    </p>
    <div class="style-cols">
      <div class="style-col">
        <h3><span class="swatch growth"></span> Growth</h3>
        <div id="growthList"></div>
      </div>
      <div class="style-col">
        <h3><span class="swatch defensive"></span> Defensive</h3>
        <div id="defensiveList"></div>
      </div>
    </div>
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
  var currentSort = "score-desc";
  var lastDecisions = [];
  var expandedTickers = new Set(); // survives sort/horizon re-renders, like the old watchlist page
  var styleByTicker = {}; // ticker -> "growth"|"defensive"|"blend", from v1's /rankings (see Growth vs Defensive section)

  // --- TradingView chart (carried over from the old watchlist page, dashboard.ts) ---

  // Maps this project's Yahoo Finance ticker spelling to TradingView's symbol
  // format (EXCHANGE:SYMBOL) -- no data is read back from TradingView, this
  // is only used to embed its official chart widget. Kept in sync with the
  // same mapping in dashboard.ts (the frozen v1 page still uses its own copy).
  var TV_SYMBOL_MAP = {
    "ABB.ST": "OMXSTO:ABB", "ADDT-B.ST": "OMXSTO:ADDT_B", "ALFA.ST": "OMXSTO:ALFA",
    "ASSA-B.ST": "OMXSTO:ASSA_B", "AZN.ST": "OMXSTO:AZN", "ATCO-A.ST": "OMXSTO:ATCO_A",
    "BOL.ST": "OMXSTO:BOL", "EPI-A.ST": "OMXSTO:EPI_A", "EQT.ST": "OMXSTO:EQT",
    "ERIC-B.ST": "OMXSTO:ERIC_B", "ESSITY-B.ST": "OMXSTO:ESSITY_B", "EVO.ST": "OMXSTO:EVO",
    "SHB-A.ST": "OMXSTO:SHB_A", "HM-B.ST": "OMXSTO:HM_B", "HEXA-B.ST": "OMXSTO:HEXA_B",
    "INDU-C.ST": "OMXSTO:INDU_C", "INVE-B.ST": "OMXSTO:INVE_B", "LIFCO-B.ST": "OMXSTO:LIFCO_B",
    "NIBE-B.ST": "OMXSTO:NIBE_B", "NDA-SE.ST": "OMXSTO:NDA_SE", "SAAB-B.ST": "OMXSTO:SAAB_B",
    "SAND.ST": "OMXSTO:SAND", "SCA-B.ST": "OMXSTO:SCA_B", "SEB-A.ST": "OMXSTO:SEB_A",
    "SKA-B.ST": "OMXSTO:SKA_B", "SKF-B.ST": "OMXSTO:SKF_B", "SWED-A.ST": "OMXSTO:SWED_A",
    "TEL2-B.ST": "OMXSTO:TEL2_B", "TELIA.ST": "OMXSTO:TELIA", "VOLV-B.ST": "OMXSTO:VOLV_B",
    "INDT.ST": "OMXSTO:INDT",
    "AAPL": "NASDAQ:AAPL", "MSFT": "NASDAQ:MSFT", "GOOGL": "NASDAQ:GOOGL", "AMZN": "NASDAQ:AMZN",
    "NVDA": "NASDAQ:NVDA", "META": "NASDAQ:META", "BRK-B": "NYSE:BRK.B", "JNJ": "NYSE:JNJ",
    "JPM": "NYSE:JPM", "XOM": "NYSE:XOM", "GS": "NYSE:GS", "CAT": "NYSE:CAT", "UNH": "NYSE:UNH",
    "V": "NYSE:V", "TRV": "NYSE:TRV", "SHW": "NYSE:SHW", "AXP": "NYSE:AXP", "HD": "NYSE:HD",
    "MCD": "NYSE:MCD", "CRM": "NYSE:CRM", "IBM": "NYSE:IBM", "HON": "NASDAQ:HON", "BA": "NYSE:BA",
    "CVX": "NYSE:CVX", "MMM": "NYSE:MMM", "MRK": "NYSE:MRK", "PG": "NYSE:PG", "CSCO": "NASDAQ:CSCO",
    "DIS": "NYSE:DIS", "WMT": "NYSE:WMT", "KO": "NYSE:KO", "VZ": "NYSE:VZ", "NKE": "NYSE:NKE",
    "MA": "NYSE:MA", "COST": "NASDAQ:COST", "LLY": "NYSE:LLY", "ABBV": "NYSE:ABBV", "ABT": "NYSE:ABT",
    "TMO": "NYSE:TMO", "DHR": "NYSE:DHR", "ISRG": "NASDAQ:ISRG", "BSX": "NYSE:BSX", "SPGI": "NYSE:SPGI",
    "MCO": "NYSE:MCO", "ICE": "NYSE:ICE", "CME": "NASDAQ:CME", "AVGO": "NASDAQ:AVGO", "TXN": "NASDAQ:TXN",
    "QCOM": "NASDAQ:QCOM", "ADI": "NASDAQ:ADI", "ORCL": "NYSE:ORCL", "ACN": "NYSE:ACN", "ROP": "NASDAQ:ROP",
    "WM": "NYSE:WM", "RSG": "NYSE:RSG", "NEE": "NYSE:NEE",
    "SIE.DE": "XETR:SIE", "SAP.DE": "XETR:SAP", "ALV.DE": "XETR:ALV", "AIR.DE": "XETR:AIR",
    "DTE.DE": "XETR:DTE", "ENR.DE": "XETR:ENR", "IFX.DE": "XETR:IFX", "DBK.DE": "XETR:DBK",
    "MUV2.DE": "XETR:MUV2", "DHL.DE": "XETR:DHL", "MRK.DE": "XETR:MRK", "RHM.DE": "XETR:RHM",
    "DB1.DE": "XETR:DB1", "BAYN.DE": "XETR:BAYN", "EOAN.DE": "XETR:EOAN", "RWE.DE": "XETR:RWE",
    "BAS.DE": "XETR:BAS", "MBG.DE": "XETR:MBG", "SHL.DE": "XETR:SHL", "CBK.DE": "XETR:CBK",
    "HSBA.L": "LSE:HSBA", "SHEL.L": "LSE:SHEL", "RR.L": "LSE:RR", "RIO.L": "LSE:RIO",
    "ULVR.L": "LSE:ULVR", "BATS.L": "LSE:BATS", "BP.L": "LSE:BP", "GSK.L": "LSE:GSK",
    "GLEN.L": "LSE:GLEN", "BARC.L": "LSE:BARC", "LLOY.L": "LSE:LLOY", "BA.L": "LSE:BA",
    "NG.L": "LSE:NG", "NWG.L": "LSE:NWG", "STAN.L": "LSE:STAN", "REL.L": "LSE:REL",
    "AAL.L": "LSE:AAL", "LSEG.L": "LSE:LSEG", "ANTO.L": "LSE:ANTO", "DGE.L": "LSE:DGE",
    "NOVO-B.CO": "OMXCOP:NOVO_B", "ORSTED.CO": "OMXCOP:ORSTED", "DSV.CO": "OMXCOP:DSV",
    "CARL-B.CO": "OMXCOP:CARL_B", "NOKIA.HE": "OMXHEX:NOKIA", "KNEBV.HE": "OMXHEX:KNEBV",
    "FORTUM.HE": "OMXHEX:FORTUM", "EQNR.OL": "OSE:EQNR", "DNB.OL": "OSE:DNB", "ORK.OL": "OSE:ORK",
    "YAR.OL": "OSE:YAR", "SALM.OL": "OSE:SALM",
    "NESN.SW": "SIX:NESN", "NOVN.SW": "SIX:NOVN", "ROG.SW": "SIX:ROG", "ZURN.SW": "SIX:ZURN",
    "SGSN.SW": "SIX:SGSN", "LONN.SW": "SIX:LONN", "GIVN.SW": "SIX:GIVN",
    "MC.PA": "EURONEXT:MC", "OR.PA": "EURONEXT:OR", "SAN.PA": "EURONEXT:SAN", "AI.PA": "EURONEXT:AI",
    "SU.PA": "EURONEXT:SU", "BNP.PA": "EURONEXT:BNP", "ASML": "NASDAQ:ASML",
    "ADYEN.AS": "EURONEXT:ADYEN", "HEIA.AS": "EURONEXT:HEIA", "ENEL.MI": "MIL:ENEL",
    "ISP.MI": "MIL:ISP", "IBE.MC": "BME:IBE", "ITX.MC": "BME:ITX", "SAN.MC": "BME:SAN",
    "TM": "NYSE:TM", "SONY": "NYSE:SONY", "SMFG": "NYSE:SMFG", "TSM": "NYSE:TSM",
    "BABA": "NYSE:BABA", "PDD": "NASDAQ:PDD", "NU": "NYSE:NU", "MELI": "NASDAQ:MELI", "INFY": "NYSE:INFY"
  };
  var RANGE_OPTIONS = [
    { label: "1D", range: "1D" }, { label: "1W", range: "5D" }, { label: "1M", range: "1M" },
    { label: "3M", range: "3M" }, { label: "6M", range: "6M" }, { label: "1Y", range: "12M" },
    { label: "5Y", range: "60M" }, { label: "All", range: "ALL" }
  ];
  var DEFAULT_RANGE = "12M";
  var selectedRanges = {}; // ticker -> range string, persists across expand/collapse and re-render

  function cssSafe(ticker) { return String(ticker).replace(/[^a-zA-Z0-9]/g, "_"); }

  // Builds the chart's DOM (range buttons + widget container), but doesn't
  // load the widget itself -- that only happens once the card is actually
  // expanded (loadChart, called from the card's click handler below), same
  // lazy-on-expand behavior as the old watchlist page.
  function chartBlock(ticker) {
    var wrap = el("div", { class: "supporting" });
    wrap.appendChild(el("h4", { text: "Price chart" }));
    var container = el("div", { class: "tv-widget-container" }, [el("div", { class: "tv-empty", text: "Loading chart\\u2026" })]);
    var rangeRow = el("div", { class: "tv-range-row" });
    var activeRange = selectedRanges[ticker] || DEFAULT_RANGE;
    RANGE_OPTIONS.forEach(function (o) {
      var btn = el("button", { type: "button", class: "tv-range-btn" + (o.range === activeRange ? " active" : ""), text: o.label });
      btn.addEventListener("click", function (e) {
        e.stopPropagation(); // don't let this bubble up to the card's own expand/collapse toggle
        if (selectedRanges[ticker] === o.range) return;
        selectedRanges[ticker] = o.range;
        rangeRow.querySelectorAll(".tv-range-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        loadChart(ticker, container);
      });
      rangeRow.appendChild(btn);
    });
    wrap.appendChild(rangeRow);
    wrap.appendChild(container);
    wrap.appendChild(el("div", { class: "tv-credit", text: "Chart by TradingView" }));
    return { wrap: wrap, container: container };
  }

  // Loads (or reloads) the TradingView Advanced Chart widget into one
  // card's container. A double requestAnimationFrame defers past the next
  // two paints -- TradingView's autosize:true widget measures its
  // container's box on creation, and right after un-hiding the card the
  // browser hasn't run a layout pass yet, so it could still measure 0x0.
  function loadChart(ticker, container) {
    var symbol = TV_SYMBOL_MAP[ticker];
    if (!symbol) {
      container.innerHTML = "";
      container.appendChild(el("div", { class: "tv-empty", text: "No TradingView symbol mapped for " + ticker + " yet." }));
      return;
    }
    container.innerHTML = "";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        // The card list can be rebuilt (sort/horizon change) while this was
        // queued, detaching the container we're about to fill -- bail if so.
        if (!document.body.contains(container)) return;
        var widgetContainer = document.createElement("div");
        widgetContainer.className = "tradingview-widget-container";
        widgetContainer.style.height = "100%";
        widgetContainer.style.width = "100%";
        var widgetDiv = document.createElement("div");
        widgetDiv.className = "tradingview-widget-container__widget";
        widgetContainer.appendChild(widgetDiv);
        var script = document.createElement("script");
        script.type = "text/javascript";
        script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
        script.async = true;
        var theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        script.text = JSON.stringify({
          autosize: true, symbol: symbol, interval: "D", range: selectedRanges[ticker] || DEFAULT_RANGE,
          timezone: "Etc/UTC", theme: theme, style: "1", locale: "en",
          allow_symbol_change: false, support_host: "https://www.tradingview.com"
        });
        widgetContainer.appendChild(script);
        container.innerHTML = "";
        container.appendChild(widgetContainer);
      });
    });
  }

  // --- Stat row, universe panel, Growth/Defensive (carried over from the old watchlist page) ---

  var universeData = null; // cached -- the configured universe doesn't change without a redeploy
  function fetchUniverse() {
    if (universeData) return Promise.resolve(universeData);
    return fetch("/universe").then(function (r) { return r.json(); }).then(function (u) { universeData = u; return u; });
  }

  function renderUniversePanel(universe) {
    var panel = document.getElementById("universePanel");
    panel.innerHTML = "";
    universe.regions.forEach(function (r) {
      var id = cssSafe(r.region);
      var region = el("div", { class: "universe-region" });
      var head = el("div", { class: "universe-region-head", "data-region": id }, [
        el("span", { class: "n", text: r.label }),
        el("span", { class: "c", text: String(r.count) })
      ]);
      var list = el("div", { class: "universe-tickers", id: "universe-tickers-" + id });
      r.tickers.forEach(function (t) { list.appendChild(el("span", { text: t.ticker })); });
      head.addEventListener("click", function () { list.classList.toggle("open"); });
      region.appendChild(head);
      region.appendChild(list);
      panel.appendChild(region);
    });
  }

  // Stats are read off v1's /rankings (the frozen baseline still runs on
  // schedule and publishes these same rows -- see index.ts) purely for the
  // "Scored / Excluded / Last run / Tracked tickers" counts; nothing here
  // feeds back into the decision engine above.
  function renderStats(rankingsData) {
    var elStats = document.getElementById("stats");
    var runAt = rankingsData.rankings[0] ? rankingsData.rankings[0].run_at : null;
    var universeCount = universeData ? universeData.totalTickers : "\\u2026";
    var panel = document.getElementById("universePanel");
    var panelExpanded = panel && !panel.hidden;
    elStats.innerHTML = "";
    elStats.appendChild(el("div", { class: "stat" }, [el("div", { class: "v", text: String(rankingsData.rankings.length) }), el("div", { class: "l", text: "Scored" })]));
    elStats.appendChild(el("div", { class: "stat" }, [el("div", { class: "v", text: String(rankingsData.excluded.length) }), el("div", { class: "l", text: "Excluded" })]));
    elStats.appendChild(el("div", { class: "stat" }, [el("div", { class: "v", style: "font-size:14px", text: runAt || "\\u2014" }), el("div", { class: "l", text: "Last run (UTC)" })]));
    var universeStat = el("div", { class: "stat clickable", id: "universeStat", "aria-expanded": panelExpanded ? "true" : "false" });
    var uLabel = el("div", { class: "l" }, [document.createTextNode("Tracked tickers "), el("span", { class: "chevron", text: "\\u25be" })]);
    universeStat.appendChild(el("div", { class: "v", text: String(universeCount) }));
    universeStat.appendChild(uLabel);
    universeStat.addEventListener("click", function () {
      var nowOpen = panel.hidden;
      panel.hidden = !nowOpen;
      universeStat.setAttribute("aria-expanded", String(nowOpen));
    });
    elStats.appendChild(universeStat);
  }

  function renderStyleList(rankings, style, elId) {
    var rows = rankings.filter(function (r) { return r.style === style; }).sort(function (a, b) { return b.composite_score - a.composite_score; });
    var listEl = document.getElementById(elId);
    if (rows.length === 0) { listEl.innerHTML = '<div class="empty">None in this universe today.</div>'; return; }
    listEl.innerHTML = "";
    rows.forEach(function (r) {
      listEl.appendChild(el("div", { class: "style-row" }, [
        el("span", { class: "t", text: r.ticker }),
        el("span", { class: "g", text: String(r.composite_score) })
      ]));
    });
  }

  // Fetches v1's /rankings (long horizon -- v1's universe is small enough
  // that every horizon's top-N is effectively the whole universe, so long
  // is the most stable one to anchor style on) purely for the stat row,
  // ticker-style badges, and Growth/Defensive lists above -- doesn't touch
  // or recompute anything, just reads what the frozen baseline already
  // publishes on its own schedule.
  function loadV1Extras() {
    fetch("/rankings?horizon=long")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        styleByTicker = {};
        (data.rankings || []).forEach(function (r) { styleByTicker[r.ticker] = r.style; });
        renderStats(data);
        renderStyleList(data.rankings || [], "growth", "growthList");
        renderStyleList(data.rankings || [], "defensive", "defensiveList");
        renderDecisionsList(); // re-render so already-drawn cards pick up their style badge
      })
      .catch(function () { /* v1 rankings not available yet -- stat row/style badges just stay empty */ });
    fetchUniverse().then(function (u) {
      renderUniversePanel(u);
      var elStats = document.getElementById("stats");
      if (elStats && elStats.children[3]) {
        var v = elStats.children[3].querySelector(".v");
        if (v) v.textContent = String(u.totalTickers);
      }
    });
  }

  // Lower rank = better. These mirror the thresholds in
  // src/decision/engine.ts's entryStatus()/valuationStatus()/decisionLabel()
  // exactly, so "best to worst" here matches what those functions consider
  // best to worst. Anything not in the map (including null/unknown, e.g.
  // valuation_status can come back "UNKNOWN" when fair-value data is
  // missing) always sorts to the bottom, in both directions -- an unknown
  // reading isn't "worse" than STRONG SELL, it's just not comparable.
  var ENTRY_RANK = { GOOD_ENTRY: 0, NEUTRAL_ENTRY: 1, WEAK_ENTRY: 2, POOR_ENTRY: 3 };
  var VALUATION_RANK = { DEEPLY_UNDERVALUED: 0, UNDERVALUED: 1, FAIRLY_VALUED: 2, EXPENSIVE: 3, VERY_EXPENSIVE: 4 };
  var DECISION_RANK = { "STRONG BUY": 0, "BUY": 1, "ACCUMULATE": 2, "HOLD / WAIT": 3, "REDUCE": 4, "SELL": 5, "STRONG SELL": 6 };

  function rankOf(map, value) {
    var r = map[String(value || "").toUpperCase()];
    return r === undefined ? null : r;
  }
  function normalizedRank(map, value, count) {
    // 0 (best) .. 1 (worst) so entry/decision/valuation ranks -- which have
    // different numbers of buckets -- combine on equal footing for the
    // "combined" sort instead of one factor dominating just because it has
    // more categories.
    var r = rankOf(map, value);
    return r === null ? null : r / Math.max(1, count - 1);
  }
  function scoreOf(d) {
    var s = Number(d.score);
    return isNaN(s) ? -Infinity : s;
  }
  // Comparator builder: keyFn returns a rank (null = unknown, always
  // last) for a decision row; ties (including two unknowns, or keyFn
  // omitted for the pure-score sorts) fall back to score, always
  // high-to-low regardless of the outer direction -- "ranked with the
  // score" means score is always the tiebreaker's own natural order, not
  // something that flips with the primary key's direction.
  function makeComparator(keyFn, dir) {
    // Rank maps are "lower number = better" (see above), which is the
    // opposite convention from a plain numeric sort where bigger = later.
    // So "desc" (best to worst) must walk the rank map in ASCENDING order
    // (best/rank-0 first) and "asc" (worst to best) DESCENDING -- inverted
    // from the plain-number case just below in sortDecisions()'s "score"
    // branch, which doesn't need this flip.
    var sign = dir === "asc" ? -1 : 1;
    return function (a, b) {
      if (keyFn) {
        var ra = keyFn(a), rb = keyFn(b);
        if (ra === null && rb !== null) return 1;
        if (rb === null && ra !== null) return -1;
        if (ra !== null && rb !== null && ra !== rb) return sign * (ra - rb);
      }
      return scoreOf(b) - scoreOf(a);
    };
  }
  function sortDecisions(list, sortKey) {
    var parts = sortKey.split("-");
    var field = parts[0], dir = parts[1];
    var sorted = list.slice();
    if (field === "score") {
      sorted.sort(function (a, b) { return (dir === "asc" ? 1 : -1) * (scoreOf(a) - scoreOf(b)); });
    } else if (field === "entry") {
      sorted.sort(makeComparator(function (d) { return rankOf(ENTRY_RANK, d.entry_status); }, dir));
    } else if (field === "decision") {
      sorted.sort(makeComparator(function (d) { return rankOf(DECISION_RANK, d.decision); }, dir));
    } else if (field === "valuation") {
      sorted.sort(makeComparator(function (d) { return rankOf(VALUATION_RANK, d.valuation_status); }, dir));
    } else if (field === "combined") {
      sorted.sort(makeComparator(function (d) {
        var parts = [
          normalizedRank(ENTRY_RANK, d.entry_status, 4),
          normalizedRank(DECISION_RANK, d.decision, 7),
          normalizedRank(VALUATION_RANK, d.valuation_status, 5),
        ].filter(function (r) { return r !== null; });
        if (!parts.length) return null;
        return parts.reduce(function (a, b) { return a + b; }, 0) / parts.length;
      }, dir));
    }
    return sorted;
  }
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
        text: "No backtest results published yet. Run scripts/backtest.sh on your machine (see Model Selection & Testing for what it does) -- it publishes here automatically when it finishes.",
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

  // EV/EBIT, EV/EBITDA, Price/Book, Net Debt/EBITDA, interest coverage,
  // Beta, ROA, and the analyst recommendation/target-price spread -- the
  // raw numbers behind some of the factor scores above, shown directly
  // rather than only as an abstracted 0-100 score. The recommendation
  // breakdown feeds Future Potential (see Reference & methodology -> Glossary -> Analyst data);
  // price targets remain a display-only cross-check.
  function renderSupportingMetrics(d) {
    var m = null;
    try { m = JSON.parse(d.supporting_metrics_json || "null"); } catch (e) {}
    if (!m) return null;

    var wrap = el("div", { class: "supporting" });

    wrap.appendChild(el("h4", { text: "Valuation & balance-sheet multiples" }));
    var grid = el("div", { class: "metric-grid" });
    grid.appendChild(metricTile("P/E", fmtX(m.trailingPe)));
    grid.appendChild(metricTile("EV/EBITDA", fmtX(m.evToEbitda), true));
    grid.appendChild(metricTile("EV/EBIT", fmtX(m.evToEbit), true));
    grid.appendChild(metricTile("Price/Book", fmtX(m.priceToBook), true));
    grid.appendChild(metricTile("Net Debt/EBITDA", fmtX(m.netDebtToEbitda)));
    grid.appendChild(metricTile("Interest coverage", fmtX(m.interestCoverage)));
    grid.appendChild(metricTile("Beta", fmt(m.beta, 2)));
    grid.appendChild(metricTile("ROA", fmtPct(m.returnOnAssets)));
    grid.appendChild(metricTile("Payout ratio", fmtPct(m.payoutRatio)));
    wrap.appendChild(grid);

    var a = m.analyst || {};
    var recTotal = (a.recStrongBuy || 0) + (a.recBuy || 0) + (a.recHold || 0) + (a.recSell || 0) + (a.recStrongSell || 0);
    if (recTotal > 0 || a.targetLow !== null) {
      wrap.appendChild(el("h4", { text: "Analyst data (recommendations feed Future Potential; price targets remain a cross-check)" }));
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

    var isExpanded = expandedTickers.has(d.ticker);
    var card = el("div", { class: "card", "aria-expanded": isExpanded ? "true" : "false" });
    var titleGroup = el("div", { style: "display:flex; align-items:center; gap:6px;" }, [
      el("div", { class: "t", text: d.ticker }),
    ]);
    var style = styleByTicker[d.ticker];
    if (style) {
      var styleLabel = style.charAt(0).toUpperCase() + style.slice(1);
      titleGroup.appendChild(el("span", { class: "style-badge " + style, text: styleLabel }));
    }
    var head = el("div", { class: "card-head" }, [
      titleGroup,
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
    var chart = chartBlock(d.ticker);
    factors.appendChild(chart.wrap);
    if (warnings.length) {
      var w = el("div", { class: "warnings" });
      warnings.forEach(function (msg) { w.appendChild(el("div", { text: "⚠ " + msg })); });
      factors.appendChild(w);
    }
    card.appendChild(factors);

    card.addEventListener("click", function () {
      var nowExpanded = card.getAttribute("aria-expanded") !== "true";
      card.setAttribute("aria-expanded", nowExpanded ? "true" : "false");
      if (nowExpanded) {
        expandedTickers.add(d.ticker);
        loadChart(d.ticker, chart.container);
      } else {
        expandedTickers.delete(d.ticker);
      }
    });
    if (isExpanded) loadChart(d.ticker, chart.container);
    return card;
  }

  function renderDecisionsList() {
    var list = document.getElementById("decisions-list");
    list.innerHTML = "";
    if (!lastDecisions.length) {
      list.appendChild(el("div", { class: "empty", text: "No decisions yet for this horizon." }));
      return;
    }
    sortDecisions(lastDecisions, currentSort).forEach(function (d) { list.appendChild(renderDecisionCard(d)); });
  }

  function loadDecisions() {
    var list = document.getElementById("decisions-list");
    list.innerHTML = '<div class="empty">Loading…</div>';
    fetch("/decisions?horizon=" + encodeURIComponent(currentHorizon))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        document.getElementById("run-at").textContent = data.runAt ? ("Last run (UTC): " + data.runAt) : "No decision run yet -- use \\"Recompute decisions now\\" below.";
        lastDecisions = data.decisions || [];
        renderDecisionsList();
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

  // --- Reference & methodology tabs (always visible, no separate toggle) ---

  var methodTabs = document.querySelectorAll("#method-tabs .tab");
  var methodSections = document.querySelectorAll(".method-section");
  methodTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var target = tab.getAttribute("data-section");
      methodTabs.forEach(function (t) { t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
      methodSections.forEach(function (s) { s.classList.toggle("active", s.getAttribute("data-section") === target); });
    });
  });

  document.getElementById("sort-select").addEventListener("change", function (e) {
    currentSort = e.target.value;
    renderDecisionsList();
  });

  renderHorizonTabs();
  loadDecisions();
  loadWeights();
  loadBacktestResults();
  loadV1Extras();
})();
</script>
</body>
</html>`;
}
