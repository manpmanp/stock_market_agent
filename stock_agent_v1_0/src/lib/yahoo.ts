// Thin client for Yahoo Finance's unofficial public endpoints.
//
// These are not a documented/supported API. They are the same endpoints
// widely used by tools like yfinance, and are the pragmatic free-tier
// starting point named as "v1: Yahoo Finance only" in the project spec.
// Two things to verify once this runs against the real internet (this
// sandbox cannot reach finance.yahoo.com to test live, see README):
//   1. Yahoo has at times required a "crumb" + cookie handshake before
//      query1/query2 endpoints respond. getCrumb() below implements the
//      standard workaround; if Yahoo changes this again, this is the
//      first place to fix.
//   2. Response shapes drift occasionally. parse.ts is written
//      defensively (optional chaining, nulls on missing fields) so a
//      shape change degrades a field to null + a source_log warning
//      rather than throwing and killing the whole ingestion run.

const CHART_HOST = "https://query1.finance.yahoo.com";
const QUOTE_SUMMARY_HOST = "https://query2.finance.yahoo.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface FetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

let cachedCrumb: { crumb: string; cookie: string } | null = null;

async function getCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (cachedCrumb) return cachedCrumb;
  try {
    const cookieResp = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
    });
    const setCookie = cookieResp.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0] ?? "";

    const crumbResp = await fetch(`${CHART_HOST}/v1/test/getcrumb`, {
      headers: { "User-Agent": USER_AGENT, Cookie: cookie },
    });
    if (!crumbResp.ok) return null;
    const crumb = (await crumbResp.text()).trim();
    if (!crumb) return null;
    cachedCrumb = { crumb, cookie };
    return cachedCrumb;
  } catch {
    return null;
  }
}

async function yahooFetch<T>(url: string): Promise<FetchResult<T>> {
  try {
    const auth = await getCrumb();
    const finalUrl = auth ? `${url}&crumb=${encodeURIComponent(auth.crumb)}` : url;
    const resp = await fetch(finalUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        ...(auth ? { Cookie: auth.cookie } : {}),
      },
    });
    if (!resp.ok) {
      return { ok: false, status: resp.status, data: null, error: `HTTP ${resp.status}` };
    }
    const data = (await resp.json()) as T;
    return { ok: true, status: resp.status, data, error: null };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: (err as Error).message };
  }
}

export async function fetchChart(ticker: string, range = "2y", interval = "1d") {
  const url = `${CHART_HOST}/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?range=${range}&interval=${interval}&events=div,splits`;
  return yahooFetch<YahooChartResponse>(url);
}

export async function fetchQuoteSummary(ticker: string) {
  const modules = [
    "price",
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "recommendationTrend",
    "assetProfile",
  ].join(",");
  const url = `${QUOTE_SUMMARY_HOST}/v10/finance/quoteSummary/${encodeURIComponent(
    ticker
  )}?modules=${modules}`;
  return yahooFetch<YahooQuoteSummaryResponse>(url);
}

// --- Minimal response typings (only the fields this project reads) ---

export interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: { currency?: string; symbol?: string; exchangeName?: string };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
        adjclose?: Array<{ adjclose: (number | null)[] }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

interface RawStat {
  raw?: number;
  fmt?: string;
}

export interface YahooQuoteSummaryResponse {
  quoteSummary: {
    result: Array<{
      price?: {
        longName?: string;
        shortName?: string;
        currency?: string;
        exchangeName?: string;
        marketCap?: RawStat;
      };
      assetProfile?: { sector?: string; industry?: string };
      summaryDetail?: {
        trailingPE?: RawStat;
        forwardPE?: RawStat;
        priceToSalesTrailing12Months?: RawStat;
        dividendYield?: RawStat;
        payoutRatio?: RawStat;
      };
      defaultKeyStatistics?: {
        priceToBook?: RawStat;
        pegRatio?: RawStat;
        enterpriseToEbitda?: RawStat;
      };
      financialData?: {
        targetMeanPrice?: RawStat;
        targetLowPrice?: RawStat;
        targetHighPrice?: RawStat;
        recommendationKey?: string;
        numberOfAnalystOpinions?: RawStat;
        revenueGrowth?: RawStat;
        earningsGrowth?: RawStat;
        grossMargins?: RawStat;
        operatingMargins?: RawStat;
        profitMargins?: RawStat;
        returnOnEquity?: RawStat;
        debtToEquity?: RawStat;
        freeCashflow?: RawStat;
        totalCash?: RawStat;
        currentPrice?: RawStat;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}
