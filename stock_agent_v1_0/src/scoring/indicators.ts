export interface PricePoint {
  date: string;
  close: number;
  volume: number | null;
}

export interface TechnicalIndicators {
  asOfDate: string | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  priceVsSma50: number | null;
  priceVsSma200: number | null;
  volatility30d: number | null;
  volumeTrend20d: number | null;
}

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const window = closes.slice(closes.length - period);
  return window.reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0] as number];
  for (let i = 1; i < values.length; i++) {
    out.push((values[i] as number) * k + (out[i - 1] as number) * (1 - k));
  }
  return out;
}

/** Wilder's RSI over `period` days (default 14). */
function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = (closes[i] as number) - (closes[i - 1] as number);
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macdLine(closes: number[]): { macd: number | null; signal: number | null } {
  if (closes.length < 35) return { macd: null, signal: null }; // need ~26 + 9 for a meaningful signal line
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdSeries = ema12.map((v, i) => v - (ema26[i] as number));
  const signalSeries = ema(macdSeries, 9);
  return {
    macd: macdSeries[macdSeries.length - 1] ?? null,
    signal: signalSeries[signalSeries.length - 1] ?? null,
  };
}

/** Annualized stdev of daily log returns over the trailing `days`. */
function volatility(closes: number[], days = 30): number | null {
  if (closes.length < days + 1) return null;
  const window = closes.slice(closes.length - (days + 1));
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    returns.push(Math.log((window[i] as number) / (window[i - 1] as number)));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

function volumeTrend(volumes: number[], shortDays = 20, longDays = 90): number | null {
  if (volumes.length < longDays) return null;
  const shortAvg = sma(volumes, shortDays);
  const longAvg = sma(volumes, longDays);
  if (!shortAvg || !longAvg || longAvg === 0) return null;
  return shortAvg / longAvg;
}

/** Computes the full indicator set from chronologically-ordered price points.
 *  Returns nulls for any indicator that doesn't yet have enough history,
 *  rather than a misleading zero or a thrown error. */
export function computeIndicators(points: PricePoint[]): TechnicalIndicators {
  if (points.length === 0) {
    return {
      asOfDate: null,
      rsi14: null,
      macd: null,
      macdSignal: null,
      sma50: null,
      sma100: null,
      sma200: null,
      priceVsSma50: null,
      priceVsSma200: null,
      volatility30d: null,
      volumeTrend20d: null,
    };
  }

  const closes = points.map((p) => p.close);
  const volumes = points.map((p) => p.volume ?? 0);
  const lastClose = closes[closes.length - 1] as number;

  const sma50 = sma(closes, 50);
  const sma100 = sma(closes, 100);
  const sma200 = sma(closes, 200);
  const { macd, signal } = macdLine(closes);

  return {
    asOfDate: points[points.length - 1]?.date ?? null,
    rsi14: rsi(closes, 14),
    macd,
    macdSignal: signal,
    sma50,
    sma100,
    sma200,
    priceVsSma50: sma50 ? (lastClose - sma50) / sma50 : null,
    priceVsSma200: sma200 ? (lastClose - sma200) / sma200 : null,
    volatility30d: volatility(closes, 30),
    volumeTrend20d: volumeTrend(volumes, 20, 90),
  };
}
