# Assessment: alternatives for factors, weighting, scoring, and ranking

Status: recommendation, nothing implemented yet. Covers the four pillars
of the Decision Lab separately, since they're independent choices that
get conflated in most writeups: what signals to track (factors), how
raw numbers become a 0-100 read per factor (scoring), how factor scores
combine into one number (weighting), and how that number becomes an
actionable list (ranking).

## 1. Factors: what to track

**Alternatives considered:**

- **Today's approach**: 10 hand-curated categories (quality, growth,
  financial_strength, valuation, future_potential, technical, entry,
  risk, catalyst, market_regime), each built from several raw inputs.
- **Statistically discovered factors** (PCA / factor analysis on the raw
  inputs, letting the data define latent groupings instead of naming
  them "quality" or "growth"). Academically cleaner, but needs far more
  history than this project has (point-in-time fundamentals don't exist
  going back years), and it throws away interpretability -- you'd no
  longer be able to say "this ticker scored low because of weak margins."
- **The standard academic quant factor set** (value, quality, momentum,
  size, low-volatility -- the Fama-French/Carhart/AQR lineage). Fewer
  factors than today's 10, each one empirically shown to carry a real
  premium over long periods in large liquid markets. Problem: that
  literature is built on thousands of stocks over decades; applying it
  unchanged to a ~20-30 ticker universe with a few years of history
  risks importing assumptions that don't hold at this scale.
- **One monolithic score**, no factor breakdown. Rejected outright: it
  directly contradicts "no black box" and the auditability requirement
  the portfolio-advice design already leans on.

**Recommendation:** keep the 10-category structure (interpretability is
worth more here than squeezing out the last bit of statistical purity on
a small universe), but do not add or change anything else in this
pipeline until the already-identified raw-input collinearity is fixed --
`debt_to_equity` feeding both financial_strength and risk, `ebit` feeding
both financial_strength and valuation, `rsi_14`/trend_state feeding both
technical and entry. Every choice below (weighting especially) is
downstream of this, and is harder to evaluate honestly while it's
unresolved. This was already next on the priority list from September;
it's now also the gating item for everything in this document.

## 2. Scoring: turning raw numbers into a 0-100 factor value

**Alternatives considered:**

- **Today's approach**: fixed absolute banding -- e.g. `band(row.return_on_equity,
  0.08, 0.3)`, meaning 8% ROE is hardcoded as the low end of "decent" and
  30% as "excellent," regardless of what the rest of the tracked universe
  is doing or what regime the market is in.
- **Cross-sectional percentile ranking**: score a ticker by where its raw
  value sits relative to every other ticker currently tracked, not
  against a fixed number typed into the code.
- **Z-score standardization**: how many standard deviations from the
  universe's own mean, then mapped onto 0-100.
- **Sector/peer-relative scoring**: percentile or z-score within sector
  rather than the whole universe -- closes the "no peer/sector-relative
  comparison" gap flagged back when the external screening articles were
  reviewed.
- **Learned per-factor scoring** (e.g. logistic regression predicting
  probability of a good outcome directly from the raw input, instead of
  a hand-picked band).

**Recommendation:** move from fixed absolute banding to cross-sectional
percentile ranking against the current tracked universe. This is the
most direct fix for the instruction that's been standing since
September: "no fixed assumption which is not verified." A line like
"8% ROE is decent" is exactly that kind of assumption -- nobody verified
it against this universe's actual distribution, it was a reasonable
guess typed into code. Percentile ranking removes the guess entirely: a
ticker scores well because it's genuinely better than most of what's
currently tracked, not because it cleared a number someone picked once.
It also auto-adapts as the universe or the market regime shifts, instead
of staying frozen at whatever looked reasonable the day it was written.
Sector-relative scoring is a good second step once the universe is large
enough per sector to make it meaningful -- with ~20-30 tickers today it
would often be ranking against 1-2 same-sector peers, which isn't
informative yet.

Keep the already-built gating/compounding/conflict-awareness logic (how
a factor's own sub-parameters combine) regardless of this choice -- it
solves a different problem (internal parameter dependency) than banding
vs. percentile does (how a single raw number becomes 0-100 in the first
place). These two aren't in competition.

## 3. Weighting: combining factor scores into one number

**Alternatives considered:**

- **Today's baseline**: fixed hand-set weights per horizon (v1, frozen).
- **Today's Decision Lab attempt**: NNLS-fitted weights, partial
  reallocation across 4 trainable factors, gated by a 3-week promotion
  streak. Has never passed once, mean IC consistently negative.
- **Equal weight (1/N)**: every factor weighted identically. Sounds
  naive, but this is a serious, well-established benchmark in portfolio
  theory -- the "naive diversification" literature has repeatedly shown
  1/N beating optimized weights out of sample, especially with limited
  data and noisy inputs, which is exactly this project's situation. It
  isn't currently being tested against at all.
- **Regularized linear regression (ridge/lasso)** instead of NNLS. NNLS
  forces every coefficient to be non-negative -- if risk, say, is
  genuinely better modeled with a negative or near-zero coefficient
  given how it's currently computed, NNLS can't express that, it just
  clamps to zero. That's a real, concrete, fixable candidate for part of
  why the fit keeps failing, not just noise.
- **GBM / tree ensemble weighting** (already a candidate in the
  harness). Captures factor interactions automatically. Worth flagging:
  this now substantially overlaps with the hand-engineered
  gating/compounding/conflict-awareness already built into factor
  scoring -- interactions are being modeled twice, once by hand and once
  statistically, which is worth tracking rather than assuming away.
- **Risk-parity / inverse-volatility weighting**: weight each factor
  inversely to its own noisiness rather than to raw predictive power.
- **Regime-conditional weighting**: different weights depending on
  detected market regime. Already on the priority list as a later-stage
  item; not where to start.

**Recommendation:** three concrete changes to the harness, before
touching anything else:

1. Add equal-weight (1/N) as a third comparison baseline alongside
   linear and GBM. If 1/N also beats the fitted weights (plausible,
   given the fitted weights are currently worse than random), that's
   important evidence the problem is in what's being fit on, not just
   how it's being fit.
2. Replace NNLS with ridge regression for the linear candidate, so
   factors aren't artificially barred from a negative coefficient.
3. Keep GBM in the comparison, but explicitly note in the Methodology
   tab that it may be re-discovering interactions the factor scoring
   already hand-encodes, so a GBM "win" gets interpreted correctly
   rather than treated as proof the hand-engineered logic was wrong.

None of this replaces the actual root-cause fix in section 1 (the raw-
input collinearity) -- it's complementary. Fixing weighting mechanics
without fixing the inputs they're fit on would still likely fail.

## 4. Ranking: turning the combined score into an actionable list

**Alternatives considered:**

- **Today's approach**: weighted average -> fixed score bands (>=85
  STRONG BUY ... <25 STRONG SELL).
- **Pure percentile rank** within the current universe, no absolute
  labels at all.
- **Expected-return ranking**: predict a forward return magnitude
  directly and rank by that, rather than collapsing to an abstracted
  0-100 score.
- **Multi-objective ranking** (e.g. a return-vs-risk frontier instead of
  one collapsed number). More sophisticated, harder to act on simply.
- **Continuous score only**, no discrete labels.

**Recommendation:** keep the composite score and fixed bands for
display -- that's what makes the output actionable and explainable at a
glance, and changing it isn't where the actual problem sits. But add the
ticker's percentile rank within the current universe alongside the
score, once section 2's percentile-based scoring is in place -- it's a
cheap addition once that data exists, and gives a second, assumption-free
read next to the labeled one.

## Net recommendation, in build order

1. Deduplicate the raw inputs shared across factor boundaries (already
   scoped from September).
2. Switch factor scoring from fixed absolute banding to cross-sectional
   percentile ranking against the tracked universe.
3. Add equal-weight (1/N) as a third harness baseline, and switch the
   linear candidate from NNLS to ridge regression.
4. Re-run the harness and see whether negative IC persists. If it still
   does after 1-3, that's strong evidence the problem is deeper than
   weighting mechanics (e.g. genuinely insufficient predictive signal in
   the current factor set, or a data/labeling issue in the harness
   itself) rather than something fixable by changing how weights are
   fit.
5. Only then revisit ranking display (percentile alongside the label).
</content>
