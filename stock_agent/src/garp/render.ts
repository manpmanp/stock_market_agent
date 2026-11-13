// Renders the GARP report as one self-contained HTML page. Pure string
// building (no DOM, no I/O) so it can later be served by the Worker as a
// /dashboard tab without changes. Colour tokens copied from the dashboard's
// validated palette (src/decisionLab.ts) for visual family; nothing imported.

import type { Computed, Conclusion, EntryStatus, Light, Region, ResearchFile } from "./types.js";
import { TOP_N, shownRows } from "./valuation.js";

const REGION_LABEL: Record<Region, string> = { nordic: "Nordic", global: "Global" };
const REGIONS: Region[] = ["nordic", "global"];

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !isFinite(x) ? "n/a" : x.toFixed(d));
const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !isFinite(x) ? "n/a" : `${(x * 100).toFixed(d)}%`);
const signed = (x: number, d = 0) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const price = (x: number) => (x >= 1000 ? x.toFixed(0) : x >= 100 ? x.toFixed(1) : x.toFixed(2));

const STATUS_CLASS: Record<EntryStatus, string> = {
  "BUY ZONE": "good",
  "NEAR ENTRY": "warn",
  "BELOW FAIR VALUE": "warn",
  "ABOVE FAIR VALUE": "bad",
};
const STATUS_ICON: Record<EntryStatus, string> = { "BUY ZONE": "●", "NEAR ENTRY": "◐", "BELOW FAIR VALUE": "○", "ABOVE FAIR VALUE": "✕" };
const LIGHT_ICON: Record<Light, string> = { green: "●", amber: "◐", red: "✕", na: "–" };

/** E = independent estimate, A = analyst opinion; unmarked = verified fact. */
const E = '<sup class="tag e" title="Independent estimate">E</sup>';
const A = '<sup class="tag a" title="Analyst opinion">A</sup>';

function mosChart(rows: Computed[]): string {
  const W = 640, rowH = 24, left = 150, right = 20, top = 24;
  const H = top + rows.length * rowH + 24;
  const lo = Math.min(-0.4, ...rows.map((r) => r.marginOfSafety)) , hi = Math.max(0.5, ...rows.map((r) => r.marginOfSafety));
  const x = (v: number) => left + ((v - lo) / (hi - lo)) * (W - left - right);
  const ticks = [-0.4, -0.2, 0, 0.2, 0.4].filter((t) => t >= lo && t <= hi);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Margin of safety by stock">`;
  for (const t of ticks) {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${H - 20}" class="${t === 0 ? "axis" : "grid"}"/>`;
    s += `<text x="${x(t)}" y="${H - 6}" class="tick" text-anchor="middle">${signed(t)}</text>`;
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const x0 = x(0), x1 = x(r.marginOfSafety);
    const bx = Math.min(x0, x1), bw = Math.max(2, Math.abs(x1 - x0));
    const cls = r.marginOfSafety >= 0 ? "pos" : "neg";
    s += `<g class="hov"><title>${esc(r.name)}: margin of safety ${signed(r.marginOfSafety)}; required ${pct(r.requiredMarginOfSafety)}</title>`;
    s += `<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>`;
    s += `<text x="${left - 8}" y="${y + 16}" text-anchor="end" class="lbl">${esc(r.ticker)}</text>`;
    s += `<rect x="${bx}" y="${y + 5}" width="${bw}" height="${rowH - 10}" rx="3" class="${cls}"/>`;
    s += `<line x1="${x(r.requiredMarginOfSafety)}" x2="${x(r.requiredMarginOfSafety)}" y1="${y + 2}" y2="${y + rowH - 2}" class="req"/>`;
    s += `<text x="${(r.marginOfSafety >= 0 ? x1 + 4 : x1 - 4)}" y="${y + 16}" text-anchor="${r.marginOfSafety >= 0 ? "start" : "end"}" class="val">${signed(r.marginOfSafety)}</text></g>`;
  });
  s += `<text x="${left}" y="12" class="tick">Bar: discount to scenario-weighted fair value. Tick: required margin of safety.</text></svg>`;
  return s;
}

function returnChart(rows: Computed[]): string {
  const W = 640, rowH = 24, left = 150, right = 48, top = 24;
  const H = top + rows.length * rowH + 24;
  const vals = rows.flatMap((r) => [r.return5y.byScenario.bear, r.return5y.byScenario.bull]);
  const lo = Math.min(-0.1, ...vals), hi = Math.max(0.2, ...vals);
  const x = (v: number) => left + ((v - lo) / (hi - lo)) * (W - left - right);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Expected annual return 2 to 5 years">`;
  for (let t = Math.ceil(lo * 20) / 20; t <= hi; t += 0.05) {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${H - 20}" class="${Math.abs(t) < 1e-9 ? "axis" : "grid"}"/>`;
    s += `<text x="${x(t)}" y="${H - 6}" class="tick" text-anchor="middle">${(t * 100).toFixed(0)}%</text>`;
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2;
    const b = r.return5y.byScenario;
    s += `<g class="hov"><title>${esc(r.name)}: bear ${pct(b.bear, 1)}, base ${pct(b.base, 1)}, bull ${pct(b.bull, 1)}, probability-weighted ${pct(r.return5y.total, 1)} per year (incl. ${pct(r.return5y.dividend, 1)} dividend)</title>`;
    s += `<rect x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}" fill="transparent"/>`;
    s += `<text x="${left - 8}" y="${y + 4}" text-anchor="end" class="lbl">${esc(r.ticker)}</text>`;
    s += `<line x1="${x(b.bear)}" x2="${x(b.bull)}" y1="${y}" y2="${y}" class="range"/>`;
    s += `<circle cx="${x(r.return5y.total)}" cy="${y}" r="5" class="dot"/>`;
    s += `<text x="${x(b.bull) + 6}" y="${y + 4}" class="val">${pct(r.return5y.total, 1)}</text></g>`;
  });
  s += `<text x="${left}" y="12" class="tick">Line: bear to bull scenario. Dot: probability-weighted total return per year.</text></svg>`;
  return s;
}

function sourcesOf(f: ResearchFile): string[] {
  const out = new Set<string>();
  const walk = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    for (const [k, val] of Object.entries(o as Record<string, unknown>)) {
      if (k === "source" && typeof val === "string" && val.startsWith("http")) out.add(val);
      else walk(val);
    }
  };
  walk(f.facts);
  return [...out];
}

function card(r: Computed, f: ResearchFile): string {
  const fa = f.facts, v = f.valuation!;
  const c = fa.consensus;
  const trap = r.trap
    .map((t) => `<span class="lt ${t.light}" title="${esc(t.indicator)}: ${esc(t.detail)}">${LIGHT_ICON[t.light]} ${esc(t.indicator)}</span>`)
    .join("");
  const gaps = fa.dataGaps.filter(Boolean);
  return `<details class="card">
<summary><span class="rk">${r.regionRank}</span><b>${esc(f.name)}</b> <span class="mut">${esc(f.ticker)} · ${esc(f.exchange)}</span>
<span class="pill ${STATUS_CLASS[r.entryStatus]}">${STATUS_ICON[r.entryStatus]} ${r.entryStatus}</span>
<span class="mut">Score ${r.composite.toFixed(0)}${E}</span></summary>
<div class="cols">
<div><h4>Why it fits</h4><p>${esc(v.whyItFits)}</p><h4>Growth drivers</h4><p>${esc(v.growthDrivers)}</p></div>
<div><h4>Valuation${E}</h4><p>Fair value ${price(r.weightedFairValue)} ${esc(f.currency)} (bear ${price(v.scenarios.bear.fairValue)} / base ${price(v.scenarios.base.fairValue)} / bull ${price(v.scenarios.bull.fairValue)}; p ${v.scenarios.bear.prob}/${v.scenarios.base.prob}/${v.scenarios.bull.prob}). ${esc(v.method)}</p>
<p><b>Entry ≤ ${price(r.entryPrice)}</b>, accumulate ${price(r.accumulateLow)}–${price(r.accumulateHigh)} (required MoS ${pct(r.requiredMarginOfSafety)}, tier ${v.qualityTier}). Bear downside ${signed(r.bearDownside)}.</p>
<p>Return 2–5y ${pct(r.return5y.total, 1)}/yr (capital ${pct(r.return5y.capital, 1)} + dividend ${pct(r.return5y.dividend, 1)})${r.return10y ? `; 5–10y ${pct(r.return10y.total, 1)}/yr` : ""}.</p></div>
<div><h4>Quality &amp; strength</h4><p>EV/EBITDA ${num(fa.evEbitdaTrailing.value)} · ND/EBITDA ${num(fa.netDebtToEbitda.value, 2)} · ROIC ${pct(fa.roic.value, 1)} · ROE ${pct(fa.roe.value, 1)} · FCF yield ${pct(fa.fcfYield.value, 1)} · payout ${pct(fa.payoutRatio.value)}</p>
<h4>Consensus${A}</h4><p>${esc(c.rating || "n/a")}${c.analysts ? `, ${c.analysts} analysts` : ""}; target ${num(c.targetAvg, 0)} (${num(c.targetLow, 0)}–${num(c.targetHigh, 0)}) <span class="mut">${esc(c.asOf)}</span></p>
<h4>Saturation</h4><p>${esc(v.saturation)}</p><p><b>Role:</b> ${esc(v.role ?? "No role assigned")}</p></div>
</div>
<div class="traps">${trap}</div>
<p class="risk"><b>Principal risk:</b> ${esc(v.principalRisk)}</p>
${gaps.length ? `<p class="mut"><b>Data gaps:</b> ${esc(gaps.join("; "))}</p>` : ""}
</details>`;
}

export function renderReport(files: ResearchFile[], allRows: Computed[], conclusion: Conclusion | null, runAt: string, title: string): string {
  const byTicker = new Map(files.map((f) => [f.ticker, f]));
  // Only the top TOP_N[region] per region are shown; the rest stay in the research data.
  const rows = shownRows(allRows);
  const hiddenCount = allRows.length - rows.length;
  const row = (r: Computed) => {
      const f = byTicker.get(r.ticker)!, fa = f.facts;
      return `<tr><td>${r.regionRank}</td><td><b>${esc(f.name)}</b><br><span class="mut">${esc(f.ticker)}</span></td>
<td>${price(r.price)} ${esc(f.currency)}<br><span class="mut">${esc(fa.price.asOf ?? "")}</span></td>
<td>${pct(r.pctOf52wHigh)}</td><td>${num(fa.peTrailing.value)} / ${num(fa.peForward.value)}</td>
<td>${num(fa.evEbitTrailing.value)} / ${num(fa.evEbitForward.value)}</td><td>${pct(fa.dividendYield.value, 1)}</td><td>${num(fa.beta5y.value, 2)}</td>
<td>${price(r.weightedFairValue)}${E}</td><td>${signed(r.upside)}${E}</td><td>${pct(r.return5y.total, 1)}${E}</td>
<td><span class="pill ${STATUS_CLASS[r.entryStatus]}">${STATUS_ICON[r.entryStatus]} ${r.entryStatus}</span></td></tr>`;
  };
  const overview = REGIONS.map((g) => {
    const rs = rows.filter((r) => r.region === g);
    return rs.length ? `<tr class="grp"><th colspan="12">Top ${TOP_N[g]} ${REGION_LABEL[g]}</th></tr>${rs.map(row).join("")}` : "";
  }).join("");
  const cards = REGIONS.map((g) => {
    const rs = rows.filter((r) => r.region === g);
    return rs.length ? `<h3 class="grp-h">${REGION_LABEL[g]}</h3>${rs.map((r) => card(r, byTicker.get(r.ticker)!)).join("")}` : "";
  }).join("");
  const concl = conclusion
    ? `<section><h2>C. Investment conclusion</h2><table class="concl"><tbody>${conclusion.picks
        .map((p) => `<tr><th>${esc(p.category)}</th><td><b>${esc(p.ticker ? byTicker.get(p.ticker)?.name ?? p.ticker : "None: insufficient evidence")}</b> ${esc(p.why)}<br><span class="mut">Risk: ${esc(p.risk)}</span></td></tr>`)
        .join("")}${conclusion.watchNotBuy.length ? `<tr><th>Watch, not buy at current prices</th><td>${conclusion.watchNotBuy.map((w) => `<b>${esc(byTicker.get(w.ticker)?.name ?? w.ticker)}</b>: ${esc(w.why)}`).join("<br>")}</td></tr>` : ""}</tbody></table></section>`
    : "";
  const sources = rows
    .map((r) => {
      const f = byTicker.get(r.ticker)!;
      const links = sourcesOf(f).slice(0, 8).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${i + 1}</a>`).join(" ");
      return `<li><b>${esc(f.ticker)}</b> (retrieved ${esc(f.retrievedAt.slice(0, 10))}): ${links || "see research file"}</li>`;
    })
    .join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--surface:#fcfcfb;--page:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;--mut:#898781;--grid:#e1e0d9;--head:#1B3A5C;
--good:#0ca30c;--warn:#c98a1c;--bad:#eb6834;--pos:#2a78d6;--neg:#e34948;--dot:#2a78d6}
@media (prefers-color-scheme:dark){:root{--surface:#1a1a19;--page:#121211;--ink:#f0efec;--ink2:#c3c2bd;--mut:#8f8d87;--grid:#33322f;--head:#9cc0e6;--pos:#4a8fe0;--dot:#4a8fe0}}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:13px/1.4 Arial,Helvetica,sans-serif}
main{max-width:1180px;margin:0 auto;padding:16px}h1{font-size:20px;color:var(--head);margin:0 0 2px}h2{font-size:15px;color:var(--head);margin:18px 0 8px;border-bottom:1px solid var(--grid);padding-bottom:4px}
h4{margin:6px 0 2px;font-size:12px;color:var(--head)}p{margin:2px 0 4px}.mut{color:var(--mut);font-size:11.5px}
.legend{font-size:11.5px;color:var(--ink2)}.tag{font-size:9px;padding:0 3px;border-radius:3px;margin-left:2px;font-weight:bold}.tag.e{color:var(--pos);border:1px solid var(--pos)}.tag.a{color:var(--ink2);border:1px solid var(--mut)}
.wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--grid);border-radius:6px}
table{border-collapse:collapse;width:100%}th,td{padding:5px 7px;text-align:left;border-bottom:1px solid var(--grid);vertical-align:top}th{font-size:11.5px;color:var(--ink2);font-weight:600;white-space:nowrap}
.ov td:nth-child(n+3){white-space:nowrap}.pill{display:inline-block;font-size:11px;font-weight:bold;padding:1px 7px;border-radius:10px;border:1px solid;white-space:nowrap}
.pill.good{color:var(--good)}.pill.warn{color:var(--warn)}.pill.bad{color:var(--bad)}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:12px}.charts>div{background:var(--surface);border:1px solid var(--grid);border-radius:6px;padding:8px}
svg{width:100%;height:auto}.grid{stroke:var(--grid)}.axis{stroke:var(--mut)}.tick{font-size:10px;fill:var(--mut)}.lbl{font-size:11px;fill:var(--ink2)}.val{font-size:10.5px;fill:var(--ink)}
.pos{fill:var(--pos)}.neg{fill:var(--neg)}.req{stroke:var(--ink);stroke-width:2}.range{stroke:var(--mut);stroke-width:2;stroke-linecap:round}.dot{fill:var(--dot);stroke:var(--surface);stroke-width:2}
.hov:hover .lbl{font-weight:bold;fill:var(--ink)}
.card{background:var(--surface);border:1px solid var(--grid);border-radius:6px;margin:6px 0;padding:6px 10px}.card summary{cursor:pointer;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.rk{display:inline-block;min-width:22px;text-align:center;font-weight:bold;color:var(--head)}.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.traps{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}.lt{font-size:11px;border:1px solid var(--grid);border-radius:10px;padding:0 6px}.lt.green{color:var(--good)}.lt.amber{color:var(--warn)}.lt.red{color:var(--bad)}.lt.na{color:var(--mut)}
.grp th{background:var(--page);color:var(--head);font-size:12.5px;font-weight:bold;padding-top:8px}.grp-h{font-size:13px;color:var(--head);margin:10px 0 4px}.risk{color:var(--ink2)}.concl th{width:230px;white-space:normal}footer{font-size:11px;color:var(--mut);margin-top:14px}footer a{color:var(--pos)}
@media (max-width:760px){.charts,.cols{grid-template-columns:1fr}.concl th{width:auto}}
</style></head><body><main>
<h1>${esc(title)}</h1>
<div class="legend">Run ${esc(runAt)} · Prices are latest verified closes (date per row) · Unmarked figures are verified facts; ${E} independent estimate; ${A} analyst opinion · Not investment advice.</div>
<section><h2>A. Market and valuation overview</h2><div class="wrap"><table class="ov"><thead><tr><th>#</th><th>Stock</th><th>Price</th><th>% of 52w high</th><th>P/E ttm / fwd</th><th>EV/EBIT ttm / fwd</th><th>Div. yield</th><th>Beta</th><th>Fair value</th><th>Upside</th><th>Return 2–5y/yr</th><th>Entry status</th></tr></thead><tbody>${overview}</tbody></table></div>
<div class="charts" style="margin-top:10px"><div>${mosChart(rows)}</div><div>${returnChart(rows)}</div></div></section>
<section><h2>B. Ranked stock comparison</h2>${cards}</section>
${concl}
<footer>${hiddenCount > 0 ? `<p>${hiddenCount} other researched stock(s) ranked below the top ${TOP_N.nordic} Nordic / top ${TOP_N.global} global and are not shown; their data is kept for future refreshes.</p>` : ""}<b>Method.</b> Fair value = probability-weighted bear/base/bull values. Margin of safety = 1 − price/fair value. Entry price = fair value × (1 − required MoS: 20% tier A, 30% B, 40% C). Return = scenario EPS growth and exit multiple over 5 years plus constant dividend yield, probability-weighted. Score = quality 20%, financial strength 15%, growth 15%, risk 15%, valuation 20%, expected return 15%, minus 5 per red value-trap check. Banks and holding companies use P/B, ROE and NAV in place of EV/EBIT and FCF.
<ul>${sources}</ul></footer>
</main></body></html>`;
}
