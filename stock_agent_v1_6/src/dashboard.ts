// Server-rendered shell + client-side fetch. Served same-origin from this
// Worker (GET /dashboard), so it can call /rankings directly with plain
// fetch() -- no CORS/CSP workarounds needed, unlike an externally-hosted
// page would require. Colors are the validated default categorical/status
// palette (see project chat log "dataviz" pass): slot 1 blue = growth,
// slot 2 orange = defensive, sequential blue = score magnitude.
export function renderDashboard(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Stock Watchlist</title>
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
    /* Two separate color axes, deliberately never sharing a hue: the style
       badge (Growth/Defensive/Blend) is a fixed categorical identity, while
       the verdict badges (valuation/entry-timing) are a good/bad/neutral
       status signal. Reusing one hue for both would make orange mean
       "Defensive" in one badge and "Overvalued" in the next -- exactly the
       "which color means what" confusion to avoid. */
    --series-growth:     #2a78d6; /* style: Growth, categorical slot 1, fixed */
    --series-defensive:  #7c5cbf; /* style: Defensive, categorical slot 2, fixed -- purple, not status-orange */
    --series-blend:      #898781; /* style: Blend, and doubles as the neutral status color (see below) */
    --seq-400:        #3987e5;
    --seq-250:        #86b6ef;
    --seq-100:        #cde2fb;
    --status-good:    #0ca30c; /* verdict: undervalued, pullback-in-uptrend */
    --status-bad:     #eb6834; /* verdict: overvalued, downtrend */
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
      --series-growth:     #3987e5;
      --series-defensive:  #9b7fd4;
      --series-blend:      #898781;
      --seq-400:        #3987e5;
      --seq-250:        #2a78d6;
      --seq-100:        #184f95;
      --status-good:    #0ca30c;
      --status-bad:     #d95926;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page);
    color: var(--text-primary);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 24px 16px 64px;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--text-secondary); font-size: 13px; margin: 0; max-width: 560px; }
  main { max-width: 1100px; margin: 0 auto; }
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; margin-bottom: 28px; }
  .header-row .stat-row { margin-bottom: 0; }
  section { margin-bottom: 40px; }
  h2 { font-size: 15px; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }
  .tabs { display: flex; gap: 6px; margin-bottom: 16px; }
  .tab {
    font-size: 13px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border);
    background: var(--surface-1); color: var(--text-secondary); cursor: pointer;
  }
  .tab[aria-selected="true"] { color: var(--text-primary); border-color: var(--seq-400); font-weight: 600; }
  .bar-track { height: 6px; border-radius: 3px; background: var(--gridline); overflow: hidden; margin-bottom: 6px; }
  .bar-fill { height: 100%; border-radius: 3px; background: var(--seq-400); }
  .badge {
    display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px;
    border-radius: 999px; color: #fff;
  }
  .badge.growth { background: var(--series-growth); }
  .badge.defensive { background: var(--series-defensive); }
  .badge.blend { background: var(--series-blend); }
  .badge.undervalued, .badge.pullback_in_uptrend { background: var(--status-good); }
  .badge.overvalued, .badge.downtrend { background: var(--status-bad); }
  .badge.fair_value, .badge.neutral, .badge.near_historical_highs { background: var(--series-blend); }
  .rationale { font-size: 12px; color: var(--text-secondary); margin-top: 8px; }
  .style-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 640px) { .style-cols { grid-template-columns: 1fr; } }
  .style-col h3 {
    font-size: 13px; display: flex; align-items: center; gap: 6px; margin: 0 0 10px;
  }
  .swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .swatch.growth { background: var(--series-growth); }
  .swatch.defensive { background: var(--series-defensive); }
  .style-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 6px;
    background: var(--surface-1); font-size: 13px;
  }
  .style-row .t { font-weight: 600; }
  .style-row .g { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .empty { color: var(--text-muted); font-size: 13px; padding: 12px; }
  .stat-row { display: flex; gap: 12px; margin-bottom: 28px; flex-wrap: wrap; }
  .stat {
    background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px 16px; min-width: 120px;
  }
  .stat .v { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat .l { font-size: 11px; color: var(--text-muted); }
  .stat.clickable { cursor: pointer; user-select: none; }
  .stat.clickable .l { display: flex; align-items: center; gap: 3px; }
  .stat.clickable .l .chevron { display: inline-block; font-size: 9px; transition: transform .15s ease; }
  .stat.clickable[aria-expanded="true"] .l .chevron { transform: rotate(180deg); }
  .universe-panel {
    background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px;
    padding: 4px 16px; margin: -16px 0 28px; max-width: 560px;
  }
  .universe-panel[hidden] { display: none; }
  .universe-region { border-bottom: 1px solid var(--gridline); padding: 10px 0; }
  .universe-region:last-child { border-bottom: none; }
  .universe-region-head { display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; font-size: 13px; }
  .universe-region-head .n { font-weight: 600; }
  .universe-region-head .c { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .universe-tickers { display: none; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .universe-tickers.open { display: flex; }
  .universe-tickers span {
    font-size: 11px; font-variant-numeric: tabular-nums; padding: 2px 7px; border-radius: 6px;
    background: var(--gridline); color: var(--text-secondary);
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--gridline); }
  th { color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
  .list-actions { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
  .toggle-table { font-size: 12px; color: var(--text-secondary); background: none; border: none; cursor: pointer; text-decoration: underline; margin-bottom: 0; padding: 0; }
  .tv-range-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 10px; }
  .tv-range-btn {
    font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px;
    border: 1px solid var(--border); background: var(--surface-1); color: var(--text-secondary);
    cursor: pointer; font: inherit; font-size: 11px;
  }
  .tv-range-btn.active { color: #fff; background: var(--seq-400); border-color: var(--seq-400); }
  .tv-widget-container { height: 460px; margin-top: 6px; border-radius: 8px; overflow: hidden; }
  .tv-empty { color: var(--text-muted); font-size: 12px; padding: 44px 0; text-align: center; }
  .tv-credit { font-size: 10px; color: var(--text-muted); margin-top: 4px; }
  .details-toggle {
    display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-secondary);
    background: none; border: none; padding: 4px 0 0; cursor: pointer; font: inherit;
  }
  .details-toggle .chevron { display: inline-block; transition: transform .15s ease; font-size: 10px; }
  .details-toggle[aria-expanded="true"] .chevron { transform: rotate(180deg); }
  .details[hidden] { display: none; }
  .details { margin-top: 10px; }
  .candidate-list { display: flex; flex-direction: column; gap: 10px; }
  .rank-item { display: flex; align-items: flex-start; gap: 10px; }
  .rank-num-big {
    flex: 0 0 auto; width: 38px; padding-top: 13px; text-align: right;
    font-size: 22px; font-weight: 800; color: var(--text-muted); font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .rank-row {
    flex: 1 1 auto; min-width: 0;
    background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px 16px;
  }
  .rank-row-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  .rank-row-head .ticker-text { font-size: 16px; font-weight: 600; margin-right: 2px; }
  .rank-row-head .score { margin-left: auto; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<main>
  <div class="header-row">
    <div>
      <h1>Stock Watchlist</h1>
      <p class="sub" id="disclaimer">Loading...</p>
    </div>
    <div class="stat-row" id="stats"></div>
  </div>
  <div class="universe-panel" id="universePanel" hidden></div>

  <section>
    <h2>Candidates by horizon</h2>
    <p class="sub" style="margin-bottom:12px">
      Every stock is scored on its own merits -- vs. its own ~5y price range, analyst
      fair value, fixed fundamental benchmarks, and its own trend -- never against the
      other tickers here. The list below is sorted for convenience, not ranked as a
      competition -- the numbers on rows 1-10 are just a scanning aid, not a ranked
      contest; read each row's own labels, not its position in the list. Every row
      carries a live TradingView chart under "Show chart & details" -- use the range
      buttons above it to jump to a preset window, or its own toolbar for interval,
      indicators, and drawing controls.
    </p>
    <div class="tabs" role="tablist">
      <button class="tab" data-horizon="short" role="tab">Short-term</button>
      <button class="tab" data-horizon="mid" role="tab">Mid-term</button>
      <button class="tab" data-horizon="long" role="tab" aria-selected="true">Long-term</button>
    </div>
    <div class="list-actions">
      <button class="toggle-table" id="toggleTable">Show as table</button>
      <button class="toggle-table" id="expandAll">Expand all</button>
      <button class="toggle-table" id="collapseAll">Collapse all</button>
    </div>
    <div class="candidate-list" id="rankedList"></div>
    <div id="top5Table" style="display:none"></div>
  </section>

  <section>
    <h2>Growth <span class="swatch growth"></span> vs Defensive <span class="swatch defensive"></span></h2>
    <p class="sub" style="margin-bottom:12px">
      A style label, not a ranking: fixed thresholds on each stock's own revenue/earnings
      growth, dividend yield, and volatility -- never compared to the rest of the universe.
      "Blend" means neither signal clears the threshold. See
      <code>src/scoring/score.ts classifyStyle()</code> for the exact rule.
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
</main>

<script>
const HORIZON_LABEL = { short: "Short-term", mid: "Mid-term", long: "Long-term" };
let currentHorizon = "long";
let cache = {};
let showTable = false;
let expandedTickers = new Set();
const AUTO_REFRESH_MS = 5 * 60 * 1000; // keep the open dashboard current between the hourly cron runs

// Maps this project's Yahoo Finance ticker spelling to TradingView's symbol
// format (EXCHANGE:SYMBOL), used only to embed TradingView's own official
// chart widget below -- no data is read back from TradingView, so this
// mapping is the only place the two symbol conventions need to agree.
// Spot-check any ticker you add here against tradingview.com/symbols/
// before relying on it -- these are hand-mapped from known conventions
// (OMXSTO: for Sweden, XETR: for German Xetra, LSE: for London, plain
// NASDAQ:/NYSE: for the US), not verified against a live TradingView
// lookup. If a card's chart shows "invalid symbol", fix its entry here.
const TV_SYMBOL_MAP = {
  // Sweden (OMXS30) -- OMXSTO: prefix, hyphens become underscores.
  "ABB.ST": "OMXSTO:ABB",
  "ADDT-B.ST": "OMXSTO:ADDT_B",
  "ALFA.ST": "OMXSTO:ALFA",
  "ASSA-B.ST": "OMXSTO:ASSA_B",
  "AZN.ST": "OMXSTO:AZN",
  "ATCO-A.ST": "OMXSTO:ATCO_A",
  "BOL.ST": "OMXSTO:BOL",
  "EPI-A.ST": "OMXSTO:EPI_A",
  "EQT.ST": "OMXSTO:EQT",
  "ERIC-B.ST": "OMXSTO:ERIC_B",
  "ESSITY-B.ST": "OMXSTO:ESSITY_B",
  "EVO.ST": "OMXSTO:EVO",
  "SHB-A.ST": "OMXSTO:SHB_A",
  "HM-B.ST": "OMXSTO:HM_B",
  "HEXA-B.ST": "OMXSTO:HEXA_B",
  "INDU-C.ST": "OMXSTO:INDU_C",
  "INVE-B.ST": "OMXSTO:INVE_B",
  "LIFCO-B.ST": "OMXSTO:LIFCO_B",
  "NIBE-B.ST": "OMXSTO:NIBE_B",
  "NDA-SE.ST": "OMXSTO:NDA_SE",
  "SAAB-B.ST": "OMXSTO:SAAB_B",
  "SAND.ST": "OMXSTO:SAND",
  "SCA-B.ST": "OMXSTO:SCA_B",
  "SEB-A.ST": "OMXSTO:SEB_A",
  "SKA-B.ST": "OMXSTO:SKA_B",
  "SKF-B.ST": "OMXSTO:SKF_B",
  "SWED-A.ST": "OMXSTO:SWED_A",
  "TEL2-B.ST": "OMXSTO:TEL2_B",
  "TELIA.ST": "OMXSTO:TELIA",
  "VOLV-B.ST": "OMXSTO:VOLV_B",
  "INDT.ST": "OMXSTO:INDT",
  // United States (Dow 30 + the original mega-cap set).
  "AAPL": "NASDAQ:AAPL",
  "MSFT": "NASDAQ:MSFT",
  "GOOGL": "NASDAQ:GOOGL",
  "AMZN": "NASDAQ:AMZN",
  "NVDA": "NASDAQ:NVDA",
  "META": "NASDAQ:META",
  "BRK-B": "NYSE:BRK.B",
  "JNJ": "NYSE:JNJ",
  "JPM": "NYSE:JPM",
  "XOM": "NYSE:XOM",
  "GS": "NYSE:GS",
  "CAT": "NYSE:CAT",
  "UNH": "NYSE:UNH",
  "V": "NYSE:V",
  "TRV": "NYSE:TRV",
  "SHW": "NYSE:SHW",
  "AXP": "NYSE:AXP",
  "HD": "NYSE:HD",
  "MCD": "NYSE:MCD",
  "CRM": "NYSE:CRM",
  "IBM": "NYSE:IBM",
  "HON": "NASDAQ:HON",
  "BA": "NYSE:BA",
  "CVX": "NYSE:CVX",
  "MMM": "NYSE:MMM",
  "MRK": "NYSE:MRK",
  "PG": "NYSE:PG",
  "CSCO": "NASDAQ:CSCO",
  "DIS": "NYSE:DIS",
  "WMT": "NYSE:WMT",
  "KO": "NYSE:KO",
  "VZ": "NYSE:VZ",
  "NKE": "NYSE:NKE",
  "MA": "NYSE:MA",
  "COST": "NASDAQ:COST",
  "LLY": "NYSE:LLY",
  "ABBV": "NYSE:ABBV",
  "ABT": "NYSE:ABT",
  "TMO": "NYSE:TMO",
  "DHR": "NYSE:DHR",
  "ISRG": "NASDAQ:ISRG",
  "BSX": "NYSE:BSX",
  "SPGI": "NYSE:SPGI",
  "MCO": "NYSE:MCO",
  "ICE": "NYSE:ICE",
  "CME": "NASDAQ:CME",
  "AVGO": "NASDAQ:AVGO",
  "TXN": "NASDAQ:TXN",
  "QCOM": "NASDAQ:QCOM",
  "ADI": "NASDAQ:ADI",
  "ORCL": "NYSE:ORCL",
  "ACN": "NYSE:ACN",
  "ROP": "NASDAQ:ROP",
  "WM": "NYSE:WM",
  "RSG": "NYSE:RSG",
  "NEE": "NYSE:NEE",
  // Germany (DAX, top 20 by market cap) -- XETR: prefix, no .DE suffix.
  "SIE.DE": "XETR:SIE",
  "SAP.DE": "XETR:SAP",
  "ALV.DE": "XETR:ALV",
  "AIR.DE": "XETR:AIR",
  "DTE.DE": "XETR:DTE",
  "ENR.DE": "XETR:ENR",
  "IFX.DE": "XETR:IFX",
  "DBK.DE": "XETR:DBK",
  "MUV2.DE": "XETR:MUV2",
  "DHL.DE": "XETR:DHL",
  "MRK.DE": "XETR:MRK",
  "RHM.DE": "XETR:RHM",
  "DB1.DE": "XETR:DB1",
  "BAYN.DE": "XETR:BAYN",
  "EOAN.DE": "XETR:EOAN",
  "RWE.DE": "XETR:RWE",
  "BAS.DE": "XETR:BAS",
  "MBG.DE": "XETR:MBG",
  "SHL.DE": "XETR:SHL",
  "CBK.DE": "XETR:CBK",
  // United Kingdom (FTSE 100, top ~19 by market cap) -- LSE: prefix, no .L suffix.
  "HSBA.L": "LSE:HSBA",
  "SHEL.L": "LSE:SHEL",
  "RR.L": "LSE:RR",
  "RIO.L": "LSE:RIO",
  "ULVR.L": "LSE:ULVR",
  "BATS.L": "LSE:BATS",
  "BP.L": "LSE:BP",
  "GSK.L": "LSE:GSK",
  "GLEN.L": "LSE:GLEN",
  "BARC.L": "LSE:BARC",
  "LLOY.L": "LSE:LLOY",
  "BA.L": "LSE:BA",
  "NG.L": "LSE:NG",
  "NWG.L": "LSE:NWG",
  "STAN.L": "LSE:STAN",
  "REL.L": "LSE:REL",
  "AAL.L": "LSE:AAL",
  "LSEG.L": "LSE:LSEG",
  "ANTO.L": "LSE:ANTO",
  "DGE.L": "LSE:DGE",
  // Nordic ex-Sweden -- OMX city-code prefixes for Copenhagen/Helsinki
  // (same OMX+city pattern as OMXSTO), OSE: for Oslo (Euronext-owned, not
  // part of Nasdaq Nordic, different prefix family).
  "NOVO-B.CO": "OMXCOP:NOVO_B",
  "ORSTED.CO": "OMXCOP:ORSTED",
  "DSV.CO": "OMXCOP:DSV",
  "CARL-B.CO": "OMXCOP:CARL_B",
  "NOKIA.HE": "OMXHEX:NOKIA",
  "KNEBV.HE": "OMXHEX:KNEBV",
  "FORTUM.HE": "OMXHEX:FORTUM",
  "EQNR.OL": "OSE:EQNR",
  "DNB.OL": "OSE:DNB",
  "ORK.OL": "OSE:ORK",
  "YAR.OL": "OSE:YAR",
  "SALM.OL": "OSE:SALM",
  // Switzerland -- SIX: prefix.
  "NESN.SW": "SIX:NESN",
  "NOVN.SW": "SIX:NOVN",
  "ROG.SW": "SIX:ROG",
  "ZURN.SW": "SIX:ZURN",
  "SGSN.SW": "SIX:SGSN",
  "LONN.SW": "SIX:LONN",
  "GIVN.SW": "SIX:GIVN",
  // Europe ex-Germany -- EURONEXT: for Paris/Amsterdam, MIL: for Milan,
  // BME: for Madrid. ASML trades its Nasdaq listing here, so it uses the
  // plain NASDAQ: prefix like the US tickers above.
  "MC.PA": "EURONEXT:MC",
  "OR.PA": "EURONEXT:OR",
  "SAN.PA": "EURONEXT:SAN",
  "AI.PA": "EURONEXT:AI",
  "SU.PA": "EURONEXT:SU",
  "BNP.PA": "EURONEXT:BNP",
  "ASML": "NASDAQ:ASML",
  "ADYEN.AS": "EURONEXT:ADYEN",
  "HEIA.AS": "EURONEXT:HEIA",
  "ENEL.MI": "MIL:ENEL",
  "ISP.MI": "MIL:ISP",
  "IBE.MC": "BME:IBE",
  "ITX.MC": "BME:ITX",
  "SAN.MC": "BME:SAN",
  // Japan and Emerging Markets -- all US-listed tickers, same NYSE:/NASDAQ:
  // convention as the US block.
  "TM": "NYSE:TM",
  "SONY": "NYSE:SONY",
  "SMFG": "NYSE:SMFG",
  "TSM": "NYSE:TSM",
  "BABA": "NYSE:BABA",
  "PDD": "NASDAQ:PDD",
  "NU": "NYSE:NU",
  "MELI": "NASDAQ:MELI",
  "INFY": "NYSE:INFY",
};

// Preset date-range buttons rendered above each TradingView widget. These map
// onto the widget's own documented "range" config value (the initial visible
// window) -- there's no reverse-engineering here, just picking from
// TradingView's own supported values, listed at
// https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/.
// Clicking one rebuilds that ticker's widget with the new range; the
// widget's own toolbar (top-left) still handles candle interval separately.
const RANGE_OPTIONS = [
  { label: '1D', range: '1D' },
  { label: '1W', range: '5D' },
  { label: '1M', range: '1M' },
  { label: '3M', range: '3M' },
  { label: '6M', range: '6M' },
  { label: '1Y', range: '12M' },
  { label: '5Y', range: '60M' },
  { label: 'All', range: 'ALL' },
];
const DEFAULT_RANGE = '12M';
let selectedRanges = {}; // ticker -> range string, persists across expand/collapse and refresh

async function fetchHorizon(h) {
  if (cache[h]) return cache[h];
  const resp = await fetch('/rankings?horizon=' + h);
  const data = await resp.json();
  cache[h] = data;
  return data;
}

function styleBadge(style) {
  if (!style) return '';
  const label = style.charAt(0).toUpperCase() + style.slice(1);
  return '<span class="badge ' + style + '">' + label + '</span>';
}

const LABEL_TEXT = {
  undervalued: 'Undervalued (own history)', overvalued: 'Overvalued (own history)', fair_value: 'Fair value',
  pullback_in_uptrend: 'Pullback in uptrend', downtrend: 'Downtrend', near_historical_highs: 'Near own highs', neutral: 'No strong signal',
};

function verdictBadges(r) {
  const parts = [];
  if (r.valuation_label) parts.push('<span class="badge ' + r.valuation_label + '">' + (LABEL_TEXT[r.valuation_label] || r.valuation_label) + '</span>');
  if (r.entry_state) parts.push('<span class="badge ' + r.entry_state + '">' + (LABEL_TEXT[r.entry_state] || r.entry_state) + '</span>');
  return parts.join('');
}

function cssSafe(ticker) { return ticker.replace(/[^a-zA-Z0-9]/g, '_'); }

function chartBlockHtml(ticker) {
  const id = cssSafe(ticker);
  const activeRange = selectedRanges[ticker] || DEFAULT_RANGE;
  const rangeRow = '<div class="tv-range-row" data-ticker="' + ticker + '">' +
    RANGE_OPTIONS.map(o =>
      '<button class="tv-range-btn' + (o.range === activeRange ? ' active' : '') + '" data-ticker="' + ticker + '" data-range="' + o.range + '">' + o.label + '</button>'
    ).join('') +
  '</div>';
  return rangeRow +
    '<div class="tv-widget-container" id="tvwrap-' + id + '"><div class="tv-empty">Loading chart...</div></div>' +
    '<div class="tv-credit">Chart by TradingView</div>';
}

// Single vertical list, no grid/columns. Ranks 1-10 get a visible number so
// the headline picks are still easy to scan at a glance; everything past
// #10 renders identically but with the number left blank, since a position
// past 10 isn't meant to read as "ranked" -- see the section intro copy
// about position not being a competition. Every row has the same
// expand-to-chart behavior (same chartBlockHtml/loadChart for every rank);
// the chart itself is lazy and only loads once a row is actually expanded,
// so nothing extra is fetched just because more rows are numbered.
function renderRankedList(rankings) {
  const list = document.getElementById('rankedList');
  if (!list) return;
  const rows = rankings.slice().sort((a, b) => a.rank - b.rank);
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty">No rankings yet -- run /ingest then /score.</div>';
    return;
  }
  list.innerHTML = rows.map(r => {
    const pct = Math.max(0, Math.min(100, r.composite_score));
    const gapLabel = r.valuation_gap_pct == null ? '' :
      (r.valuation_gap_pct < 0 ? 'below' : 'above') + ' fair value by ' +
      Math.abs(Math.round(r.valuation_gap_pct * 1000) / 10) + '%';
    const id = cssSafe(r.ticker);
    const isExpanded = expandedTickers.has(r.ticker);
    const rankBig = '<div class="rank-num-big">' + (r.rank <= 10 ? '#' + r.rank : '') + '</div>';
    return '<div class="rank-item">' +
      rankBig +
      '<div class="rank-row">' +
      '<div class="rank-row-head">' +
        '<span class="ticker-text">' + r.ticker + '</span>' +
        styleBadge(r.style) + verdictBadges(r) +
        '<span class="score">' + r.composite_score + '</span>' +
      '</div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
      '<button class="details-toggle" data-ticker="' + r.ticker + '" data-rank="' + r.rank + '" aria-expanded="' + isExpanded + '">' +
        '<span class="label">' + (isExpanded ? 'Show less' : 'Show chart & details') + '</span> <span class="chevron">▾</span>' +
      '</button>' +
      '<div class="details" id="details-' + id + '"' + (isExpanded ? '' : ' hidden') + '>' +
        chartBlockHtml(r.ticker) +
        '<div class="rationale">' + (gapLabel ? gapLabel + '. ' : '') + (r.rationale || '') + '</div>' +
      '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// Loads (or re-loads) the TradingView Advanced Chart widget for one ticker
// into its container. TradingView's widget live-updates on its own once
// embedded -- this only needs to run when a card is expanded, or when the
// surrounding grid gets rebuilt (horizon switch, the 5-minute auto-refresh)
// and the container element is recreated from scratch.
function loadChart(ticker) {
  const id = cssSafe(ticker);
  const wrap = document.getElementById('tvwrap-' + id);
  if (!wrap) return;
  const symbol = TV_SYMBOL_MAP[ticker];
  if (!symbol) {
    wrap.innerHTML = '<div class="tv-empty">No TradingView symbol mapped for ' + ticker + ' yet.</div>';
    return;
  }
  wrap.innerHTML = '';
  // TradingView's autosize:true widget measures its container's box on
  // creation. If we build the script tag synchronously -- e.g. right inside
  // the same click handler that just cleared the hidden attribute on the
  // parent .details panel -- the browser hasn't run a layout pass yet, so
  // the container can still measure 0x0 and the widget mounts with no data
  // (header/toolbar draw, but O/H/L/C stay blank). A double
  // requestAnimationFrame defers this past the next two paints, by which
  // point the unhide has definitely been laid out.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // The card grid can be rebuilt (horizon switch, auto-refresh) while
      // this was queued, which would detach the container we're about to
      // fill -- re-fetch it by id and bail if it's gone.
      const liveWrap = document.getElementById('tvwrap-' + id);
      if (!liveWrap) return;
      const container = document.createElement('div');
      container.className = 'tradingview-widget-container';
      container.style.height = '100%';
      container.style.width = '100%';
      const widgetDiv = document.createElement('div');
      widgetDiv.className = 'tradingview-widget-container__widget';
      container.appendChild(widgetDiv);
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
      script.async = true;
      const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      script.text = JSON.stringify({
        autosize: true,
        symbol: symbol,
        interval: 'D',
        range: selectedRanges[ticker] || DEFAULT_RANGE,
        timezone: 'Etc/UTC',
        theme: theme,
        style: '1',
        locale: 'en',
        allow_symbol_change: false,
        support_host: 'https://www.tradingview.com',
      });
      container.appendChild(script);
      liveWrap.innerHTML = '';
      liveWrap.appendChild(container);
    });
  });
}

// Any expanded row -- top 5 or below -- gets its TradingView widget
// (re)loaded. Collapsed rows are skipped entirely: nothing fetches or
// renders until a user actually opens that row's details.
function loadExpandedCharts(rankings) {
  rankings.filter(r => expandedTickers.has(r.ticker)).forEach(r => loadChart(r.ticker));
}

function renderTop5Table(rankings) {
  const rows = rankings.slice().sort((a,b) => a.rank - b.rank);
  const el = document.getElementById('top5Table');
  if (rows.length === 0) { el.innerHTML = '<div class="empty">No rankings yet.</div>'; return; }
  el.innerHTML = '<table><thead><tr><th>Ticker</th><th>Score</th><th>Valuation</th><th>Entry timing</th><th>Style</th><th>Rationale</th></tr></thead><tbody>' +
    rows.map(r => '<tr><td>' + r.ticker + '</td><td>' + r.composite_score +
      '</td><td>' + (LABEL_TEXT[r.valuation_label] || r.valuation_label || '') +
      '</td><td>' + (LABEL_TEXT[r.entry_state] || r.entry_state || '') +
      '</td><td>' + (r.style || '') + '</td><td>' + (r.rationale || '') + '</td></tr>').join('') +
    '</tbody></table>';
}

function renderStyleList(rankings, style, elId) {
  const rows = rankings.filter(r => r.style === style).sort((a,b) => b.composite_score - a.composite_score);
  const el = document.getElementById(elId);
  if (rows.length === 0) { el.innerHTML = '<div class="empty">None in this universe today.</div>'; return; }
  el.innerHTML = rows.map(r =>
    '<div class="style-row"><span class="t">' + r.ticker + '</span><span class="g">' + r.composite_score + '</span></div>'
  ).join('');
}

let universeData = null; // cached -- the configured universe doesn't change without a redeploy
async function fetchUniverse() {
  if (universeData) return universeData;
  const resp = await fetch('/universe');
  universeData = await resp.json();
  return universeData;
}

function renderUniversePanel(universe) {
  const panel = document.getElementById('universePanel');
  panel.innerHTML = universe.regions.map(r => {
    const id = cssSafe(r.region);
    return '<div class="universe-region">' +
      '<div class="universe-region-head" data-region="' + id + '">' +
        '<span class="n">' + r.label + '</span><span class="c">' + r.count + '</span>' +
      '</div>' +
      '<div class="universe-tickers" id="universe-tickers-' + id + '">' +
        r.tickers.map(t => '<span>' + t.ticker + '</span>').join('') +
      '</div>' +
    '</div>';
  }).join('');
}

function renderStats(data) {
  const el = document.getElementById('stats');
  const runAt = data.rankings[0] ? data.rankings[0].run_at : null;
  const universeCount = universeData ? universeData.totalTickers : '\\u2026';
  const panelExpanded = document.getElementById('universePanel') && !document.getElementById('universePanel').hidden;
  el.innerHTML =
    '<div class="stat"><div class="v">' + data.rankings.length + '</div><div class="l">Scored</div></div>' +
    '<div class="stat"><div class="v">' + data.excluded.length + '</div><div class="l">Excluded</div></div>' +
    '<div class="stat"><div class="v" style="font-size:14px">' + (runAt || '\\u2014') + '</div><div class="l">Last run (UTC)</div></div>' +
    '<div class="stat clickable" id="universeStat" aria-expanded="' + panelExpanded + '">' +
      '<div class="v">' + universeCount + '</div><div class="l">Tracked tickers <span class="chevron">\\u25be</span></div>' +
    '</div>';
  document.getElementById('disclaimer').textContent = data.disclaimer;
}

document.addEventListener('click', (e) => {
  const universeStat = e.target.closest ? e.target.closest('#universeStat') : null;
  if (universeStat) {
    const panel = document.getElementById('universePanel');
    const nowOpen = panel.hidden; // opening if it was hidden
    panel.hidden = !nowOpen;
    universeStat.setAttribute('aria-expanded', String(nowOpen));
    return;
  }
  const regionHead = e.target.closest ? e.target.closest('.universe-region-head') : null;
  if (regionHead) {
    const list = document.getElementById('universe-tickers-' + regionHead.dataset.region);
    if (list) list.classList.toggle('open');
    return;
  }
  const rangeBtn = e.target.closest ? e.target.closest('.tv-range-btn') : null;
  if (rangeBtn) {
    const ticker = rangeBtn.dataset.ticker;
    const range = rangeBtn.dataset.range;
    if (selectedRanges[ticker] === range) return; // already active, nothing to do
    selectedRanges[ticker] = range;
    const row = rangeBtn.closest('.tv-range-row');
    if (row) row.querySelectorAll('.tv-range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === range));
    loadChart(ticker);
    return;
  }
  const btn = e.target.closest ? e.target.closest('.details-toggle') : null;
  if (!btn) return;
  const ticker = btn.dataset.ticker;
  const details = document.getElementById('details-' + cssSafe(ticker));
  if (!details) return;
  const wasExpanded = btn.getAttribute('aria-expanded') === 'true';
  const nowExpanded = !wasExpanded;
  btn.setAttribute('aria-expanded', String(nowExpanded));
  btn.querySelector('.label').textContent = nowExpanded ? 'Show less' : 'Show more';
  details.hidden = !nowExpanded;
  if (nowExpanded) {
    expandedTickers.add(ticker);
    loadChart(ticker);
  } else {
    expandedTickers.delete(ticker);
  }
});

async function render() {
  const data = await fetchHorizon(currentHorizon);
  renderStats(data);
  if (showTable) {
    renderTop5Table(data.rankings);
  } else {
    renderRankedList(data.rankings);
    loadExpandedCharts(data.rankings);
  }
  // growth/defensive uses the long-horizon list as the base "all scored tickers"
  // view (v1's universe is small enough that every horizon's top-N == the
  // whole universe, but long is the most stable one to anchor style on).
  const longData = await fetchHorizon('long');
  renderStyleList(longData.rankings, 'growth', 'growthList');
  renderStyleList(longData.rankings, 'defensive', 'defensiveList');
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', 'false'));
    btn.setAttribute('aria-selected', 'true');
    currentHorizon = btn.dataset.horizon;
    render();
  });
});

document.getElementById('toggleTable').addEventListener('click', () => {
  showTable = !showTable;
  document.getElementById('rankedList').style.display = showTable ? 'none' : 'flex';
  document.getElementById('top5Table').style.display = showTable ? 'block' : 'none';
  document.getElementById('toggleTable').textContent = showTable ? 'Show as cards' : 'Show as table';
  document.getElementById('expandAll').style.display = showTable ? 'none' : '';
  document.getElementById('collapseAll').style.display = showTable ? 'none' : '';
  render();
});

// Expand/collapse every row at once -- useful when comparing several charts
// in a row, or backing out of a "everything expanded" view without clicking
// each row's own toggle. Only affects the currently-loaded horizon's rows;
// switching horizons or auto-refresh redraws from expandedTickers as usual,
// so an "expand all" done on Long-term doesn't carry over to Short-term.
document.getElementById('expandAll').addEventListener('click', async () => {
  const data = await fetchHorizon(currentHorizon);
  data.rankings.forEach(r => expandedTickers.add(r.ticker));
  render();
});

document.getElementById('collapseAll').addEventListener('click', () => {
  expandedTickers.clear();
  render();
});

render();

// Fetched once (the configured universe doesn't change without a redeploy) --
// updates the "Tracked tickers" stat and builds the dropdown panel content as
// soon as it arrives, independent of the rankings render() above.
fetchUniverse().then(u => {
  renderUniversePanel(u);
  const stat = document.getElementById('universeStat');
  if (stat) stat.querySelector('.v').textContent = u.totalTickers;
});

// Keeps an open tab current between the hourly cron runs without a manual reload.
// Clears the rankings cache (not TradingView's widget, which live-updates on its
// own once embedded) so a re-render actually picks up fresh scores, and re-fetches
// on the horizon tab the user currently has selected rather than resetting their
// view. Any expanded TradingView chart gets rebuilt each cycle since the whole
// card grid is redrawn from scratch -- a brief reload of that one widget, not a
// full page refresh.
setInterval(() => {
  cache = {};
  render();
}, AUTO_REFRESH_MS);
</script>
</body>
</html>`;
}
