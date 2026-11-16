// Live-price overlay for the GARP checker. On each /garp.json request the
// Worker reads the agent's own latest closes from D1 (read-only) and swaps
// them in for the price researched at the last GARP run, so margin of
// safety, upside, returns and buy-zone status are current. Fair values,
// scenarios and all other facts stay exactly as researched. Nothing is
// written anywhere; the agent's scoring/decisions are not touched.

import type { Field, ResearchFile } from "./types.js";

export interface LiveQuote {
  ticker: string;
  close: number;
  date: string; // YYYY-MM-DD
  high52w: number | null;
  low52w: number | null;
}

/** A live price this far from the researched one is treated as a data or unit problem and ignored. */
export const MAX_LIVE_JUMP = 0.4;
export const LIVE_SOURCE = "stock-agent D1 price_history (live)";

export interface OverlayResult {
  files: ResearchFile[];
  live: Record<string, string>; // ticker -> date of the live close used
  skipped: Record<string, string>; // ticker -> reason
}

/** Pure: returns copies of the research files with live prices applied where valid. */
export function overlayLivePrices(files: ResearchFile[], quotes: LiveQuote[]): OverlayResult {
  const byTicker = new Map(quotes.map((q) => [q.ticker, q]));
  const live: Record<string, string> = {};
  const skipped: Record<string, string> = {};
  const out = files.map((f) => {
    const q = byTicker.get(f.ticker);
    if (!q || !(q.close > 0)) return f;
    const researched = f.facts.price.value;
    const researchedDate = f.facts.price.asOf ?? "";
    if (researchedDate && q.date < researchedDate) {
      skipped[f.ticker] = `live close ${q.date} older than researched ${researchedDate}`;
      return f;
    }
    if (researched && Math.abs(q.close / researched - 1) > MAX_LIVE_JUMP) {
      skipped[f.ticker] = `live close ${q.close} differs >${MAX_LIVE_JUMP * 100}% from researched ${researched}; check units`;
      return f;
    }
    const field = (value: number | null, note: string): Field => ({ value, period: "close", source: LIVE_SOURCE, asOf: q.date, note });
    const facts = {
      ...f.facts,
      price: field(q.close, `Live close; researched ${researched ?? "n/a"} on ${researchedDate || "n/a"}`),
      high52w: q.high52w ? field(q.high52w, "Max daily high over the last 365 days of agent price history") : f.facts.high52w,
      low52w: q.low52w ? field(q.low52w, "Min daily low over the last 365 days of agent price history") : f.facts.low52w,
    };
    live[f.ticker] = q.date;
    return { ...f, facts };
  });
  return { files: out, live, skipped };
}

/** Reads latest close and 52-week range for the given tickers from the agent's D1 (read-only). */
export async function fetchLiveQuotes(db: D1Database, tickers: string[]): Promise<LiveQuote[]> {
  if (!tickers.length) return [];
  const marks = tickers.map(() => "?").join(",");
  const sql = `
    SELECT p.ticker AS ticker, p.close AS close, p.date AS date,
      (SELECT MAX(h.high) FROM price_history h WHERE h.ticker = p.ticker AND h.date >= date(p.date, '-365 days')) AS high52w,
      (SELECT MIN(h.low)  FROM price_history h WHERE h.ticker = p.ticker AND h.date >= date(p.date, '-365 days')) AS low52w
    FROM price_history p
    JOIN (SELECT ticker, MAX(date) AS md FROM price_history WHERE ticker IN (${marks}) AND close IS NOT NULL GROUP BY ticker) m
      ON p.ticker = m.ticker AND p.date = m.md`;
  const res = await db.prepare(sql).bind(...tickers).all<LiveQuote>();
  return res.results ?? [];
}
