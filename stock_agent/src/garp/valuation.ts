// Deterministic GARP valuation maths. Pure functions, no I/O, no model
// calls, so the same research inputs always give the same output. Formulas
// follow docs/garp/master-prompt.md sections 4-5.

import type {
  Region,
  Computed, EntryStatus, Facts, Light, QualityTier, ResearchFile, Scenario, TrapCheck, ValuationInput,
} from "./types.js";

/** Required discount to fair value before the price counts as a buy, by quality tier. */
export const REQUIRED_MOS: Record<QualityTier, number> = { A: 0.2, B: 0.3, C: 0.4 };
/** Width of the accumulation range below the entry price. */
export const ACCUMULATE_WIDTH = 0.1;
/** Assumed cost of capital for the ROIC check (nominal SEK/EUR/DKK/NOK large caps). */
export const WACC = 0.08;

/** Composite weights (sum 1). Judgement scores 1-5 map to 0-100. */
export const WEIGHTS = {
  quality: 0.2,
  financialStrength: 0.15,
  growth: 0.15,
  risk: 0.15,
  valuation: 0.2,
  expectedReturn: 0.15,
} as const;
export const TRAP_RED_PENALTY = 5;

export function marginOfSafety(price: number, fairValue: number): number {
  return 1 - price / fairValue;
}

export function upside(price: number, fairValue: number): number {
  return fairValue / price - 1;
}

export function weightedFairValue(s: ValuationInput["scenarios"]): number {
  const total = s.bear.prob + s.base.prob + s.bull.prob;
  if (Math.abs(total - 1) > 1e-6) throw new Error(`scenario probabilities sum to ${total}, must be 1`);
  return s.bear.fairValue * s.bear.prob + s.base.fairValue * s.base.prob + s.bull.fairValue * s.bull.prob;
}

/** Annualised capital return from re-rating plus earnings growth over n years. */
export function capitalCagr(price: number, basis: number, growth: number, exitMultiple: number, years: number): number {
  const exitPrice = basis * Math.pow(1 + growth, years) * exitMultiple;
  if (exitPrice <= 0 || price <= 0) return -1;
  return Math.pow(exitPrice / price, 1 / years) - 1;
}

export function scenarioReturns(price: number, v: ValuationInput, years: 5 | 10) {
  const out = {} as Record<"bear" | "base" | "bull", { capital: number; prob: number }>;
  for (const k of ["bear", "base", "bull"] as const) {
    const s: Scenario = v.scenarios[k];
    const g = years === 5 ? s.epsCagr5y : s.epsCagr10y;
    const m = years === 5 ? s.exitPe5y : s.exitPe10y;
    if (g === undefined || m === undefined) return null;
    out[k] = { capital: capitalCagr(price, v.basisValue, g, m, years), prob: s.prob };
  }
  const capital = out.bear.capital * out.bear.prob + out.base.capital * out.base.prob + out.bull.capital * out.bull.prob;
  const dividend = v.forwardDividendYield;
  return {
    capital,
    dividend,
    total: capital + dividend,
    byScenario: { bear: out.bear.capital + dividend, base: out.base.capital + dividend, bull: out.bull.capital + dividend },
  };
}

export function entryStatus(price: number, fairValue: number, required: number): EntryStatus {
  if (price <= fairValue * (1 - required)) return "BUY ZONE";
  if (price <= fairValue * (1 - required / 2)) return "NEAR ENTRY";
  if (price <= fairValue) return "BELOW FAIR VALUE";
  return "ABOVE FAIR VALUE";
}

const v = (f: { value: number | null } | undefined): number | null => (f ? f.value : null);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Mandatory bargain-vs-value-trap checklist (master prompt 4E). */
export function trapChecklist(facts: Facts, val: ValuationInput): TrapCheck[] {
  const checks: TrapCheck[] = [];
  const special = val.kind !== "standard";

  // 1. Forward vs trailing multiple -- same metric on both sides (EV/EBIT
  // pair if complete, otherwise the P/E pair), never mixed.
  const evPair = [v(facts.evEbitTrailing), v(facts.evEbitForward)] as const;
  const pePair = [v(facts.peTrailing), v(facts.peForward)] as const;
  const [label, tr, fw] =
    evPair[0] !== null && evPair[1] !== null ? ["EV/EBIT", evPair[0], evPair[1]] as const : ["P/E", pePair[0], pePair[1]] as const;
  if (tr === null || fw === null || tr <= 0) checks.push({ indicator: "Forward vs trailing", light: "na", detail: "unavailable" });
  else {
    const r = fw / tr;
    checks.push({
      indicator: "Forward vs trailing",
      light: r <= 1.05 ? "green" : r <= 1.2 ? "amber" : "red",
      detail: `${label} ${tr.toFixed(1)} → ${fw.toFixed(1)}`,
    });
  }

  // 2. Revenue trend
  const rev = facts.history.map((h) => h.revenue).filter((x): x is number => x !== null && x > 0);
  if (rev.length < 3) checks.push({ indicator: "Revenue trend", light: "na", detail: "fewer than 3 years" });
  else {
    const cagr = Math.pow(rev[rev.length - 1]! / rev[0]!, 1 / (rev.length - 1)) - 1;
    let declines = 0;
    for (let i = 1; i < rev.length; i++) if (rev[i]! < rev[i - 1]!) declines++;
    const light: Light = cagr > 0.03 && declines <= 1 ? "green" : cagr > 0 ? "amber" : "red";
    checks.push({ indicator: "Revenue trend", light, detail: `CAGR ${pct(cagr)}, ${declines} down yr(s)` });
  }

  // 3. Operating margin trend
  const m = facts.history.map((h) => h.ebitMargin).filter((x): x is number => x !== null);
  if (special || m.length < 3) checks.push({ indicator: "Operating margin", light: "na", detail: special ? "n/a for sector" : "fewer than 3 years" });
  else {
    const last = m[m.length - 1]!;
    const prior = m.slice(0, -1).reduce((a, b) => a + b, 0) / (m.length - 1);
    const d = last - prior;
    checks.push({
      indicator: "Operating margin",
      light: d >= -0.01 ? "green" : d >= -0.03 ? "amber" : "red",
      detail: `${pct(last)} vs avg ${pct(prior)}`,
    });
  }

  // 4. Leverage
  const nd = v(facts.netDebtToEbitda);
  if (special || nd === null) checks.push({ indicator: "Net debt/EBITDA", light: "na", detail: special ? "n/a for sector" : "unavailable" });
  else checks.push({ indicator: "Net debt/EBITDA", light: nd < 2 ? "green" : nd <= 3.5 ? "amber" : "red", detail: `${nd.toFixed(2)}x` });

  // 5. Cash conversion (FCF / EBIT over available history)
  const pairs = facts.history.filter((h) => h.fcf !== null && h.ebit !== null && h.ebit! > 0);
  if (special || pairs.length < 2) checks.push({ indicator: "FCF conversion", light: "na", detail: special ? "n/a for sector" : "insufficient history" });
  else {
    const conv = pairs.reduce((a, h) => a + h.fcf!, 0) / pairs.reduce((a, h) => a + h.ebit!, 0);
    const anyNeg = pairs.some((h) => h.fcf! < 0);
    checks.push({
      indicator: "FCF conversion",
      light: anyNeg ? "red" : conv >= 0.6 ? "green" : conv >= 0.35 ? "amber" : "red",
      detail: `FCF/EBIT ${pct(conv)} over ${pairs.length} yrs`,
    });
  }

  // 6. ROIC vs WACC (ROE for banks)
  const roic = val.kind === "bank" ? v(facts.roe) : v(facts.roic);
  if (val.kind === "holding" || roic === null) checks.push({ indicator: "ROIC vs WACC", light: "na", detail: val.kind === "holding" ? "n/a for holding co." : "unavailable" });
  else {
    const hurdle = val.kind === "bank" ? 0.1 : WACC;
    checks.push({
      indicator: val.kind === "bank" ? "ROE vs cost of equity" : "ROIC vs WACC",
      light: roic >= hurdle + 0.04 ? "green" : roic >= hurdle ? "amber" : "red",
      detail: `${pct(roic)} vs ${pct(hurdle)}`,
    });
  }

  // 7. Verification flags (verifiers list caveats freely: 0-1 green, 2-3 amber, 4+ red)
  const flags = facts.valueTrapFlags.filter((f) => f && f.trim().length > 0);
  checks.push({
    indicator: "Verification flags",
    light: flags.length <= 1 ? "green" : flags.length <= 3 ? "amber" : "red",
    detail: flags.length === 0 ? "none" : `${flags.length} flag(s)`,
  });

  // 8. Competitive position (analyst judgement, recorded in valuation block)
  checks.push({
    indicator: "Competitive position",
    light: val.competitive === "weakening" ? "red" : val.competitive === "stable" ? "green" : "green",
    detail: val.competitive,
  });
  return checks;
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const score5 = (s: number) => clamp(((s - 1) / 4) * 100);

export function composite(val: ValuationInput, mos: number, ret5: number, reds: number): number {
  const valuation = clamp(((mos + 0.3) / 0.7) * 100); // MoS -30% → 0, +40% → 100
  const expected = clamp((ret5 / 0.15) * 100); // 0% → 0, 15%/yr → 100
  const raw =
    WEIGHTS.quality * score5(val.scores.quality) +
    WEIGHTS.financialStrength * score5(val.scores.financialStrength) +
    WEIGHTS.growth * score5(val.scores.growth) +
    WEIGHTS.risk * score5(val.scores.risk) +
    WEIGHTS.valuation * valuation +
    WEIGHTS.expectedReturn * expected;
  return clamp(raw - TRAP_RED_PENALTY * reds);
}

/** Report shows this many stocks per region; the rest stay in the data. */
export const TOP_N = 5;
const NORDIC_SUFFIX = /\.(ST|CO|OL|HE|IC)$/i;

export function regionOf(r: ResearchFile): Region {
  return r.region ?? (NORDIC_SUFFIX.test(r.ticker) ? "nordic" : "global");
}

export function computeOne(r: ResearchFile): Omit<Computed, "rank" | "regionRank"> {
  const val = r.valuation;
  if (!val) throw new Error(`${r.ticker}: no valuation block`);
  const price = r.facts.price.value;
  if (price === null || price <= 0) throw new Error(`${r.ticker}: no verified price`);
  const fv = weightedFairValue(val.scenarios);
  const req = REQUIRED_MOS[val.qualityTier];
  const r5 = scenarioReturns(price, val, 5);
  if (!r5) throw new Error(`${r.ticker}: 5y scenario inputs missing`);
  const r10 = scenarioReturns(price, val, 10);
  const trap = trapChecklist(r.facts, val);
  const reds = trap.filter((t) => t.light === "red").length;
  const mos = marginOfSafety(price, fv);
  const hi = r.facts.high52w.value;
  return {
    ticker: r.ticker,
    name: r.name,
    currency: r.currency,
    price,
    weightedFairValue: fv,
    marginOfSafety: mos,
    upside: upside(price, fv),
    bearDownside: val.scenarios.bear.fairValue / price - 1,
    requiredMarginOfSafety: req,
    entryPrice: fv * (1 - req),
    accumulateLow: fv * (1 - req - ACCUMULATE_WIDTH),
    accumulateHigh: fv * (1 - req),
    entryStatus: entryStatus(price, fv, req),
    return5y: r5,
    return10y: r10 ? { capital: r10.capital, dividend: r10.dividend, total: r10.total } : null,
    pctOf52wHigh: hi ? price / hi : null,
    trap,
    trapReds: reds,
    composite: composite(val, mos, r5.total, reds),
    region: regionOf(r),
  };
}

export function computeAll(files: ResearchFile[]): Computed[] {
  const rows = files.filter((f) => f.valuation).map(computeOne);
  rows.sort((a, b) => b.composite - a.composite);
  const seen: Record<Region, number> = { nordic: 0, global: 0 };
  return rows.map((r, i) => ({ ...r, rank: i + 1, regionRank: ++seen[r.region] }));
}

/** The stocks the report shows: top TOP_N per region, in rank order. */
export function shownRows(rows: Computed[], n = TOP_N): Computed[] {
  return rows.filter((r) => r.regionRank <= n);
}
