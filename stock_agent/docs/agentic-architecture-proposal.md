# Proposal: an analyst/engineer agent loop on top of the existing pipeline

Status: draft for review, nothing implemented yet. Revised twice:
(1) position sizing ("how much") is out of scope for now -- that stays
your own call, made against your own budget; it is planned as a later
phase that also decides when to place the order, not dropped permanently.
(2) this is not a personalized-holdings advisor. Your current holdings are
irrelevant to this stage -- the job is to check benchmarks, indexes, and
the tracked universe, and update the score/rank/filtered entry list per
horizon using price history, indicators, statistical analysis, and a
market-psychology signal. The endpoint stays on-demand (you call it when
you want a fresh read), not a scheduled cron step -- cheaper and simpler,
and matches how you'd actually use it.

## 1. Mapping the two roles onto the real system

Agent1 (analyst) owns policy: what to track, how to analyze it, when to
enter, for what horizon. Agent2 (engineer/data scientist) owns the
system: pipeline decomposition, which model runs at which stage, the
harness that controls and evaluates the whole thing, and the line between
what is agentic and what is a deterministic skill.

Agent1's job is already encoded in the repo today, just not as an LLM:
`config/universe.json` (what to track), `src/decision/types.ts` `FACTORS`
and the banding assumptions inside each `scoreX` function (how to
analyze), and the entry/valuation classifications in `engine.ts` (when to
enter). With sizing explicitly out of scope, there is no longer a gap in
agent1's job that the current system fails to cover -- it already ranks,
labels, and classifies every tracked ticker; it was never supposed to
tell you how much of your money to put where, and that stays true.

Agent2's job is also already built: `scripts/backtest/harness.py` and
`promote-weights.ts` are literally the harness that decides which model
(linear / GBM / TabPFN) gets used, and gates it on evidence before it goes
live.

## 2. The seven existing stages, in depth -- who owns each, and whether it should stay a skill

**Ingestion** (`src/ingestion/run.ts`, `lib/yahoo.ts`, `lib/parse.ts`).
Pulls raw price history, fundamentals, valuation, and analyst data from
Yahoo Finance per ticker, writes it into D1. Pure I/O and parsing -- no
judgment anywhere in it. Agent2's domain entirely. Should never become
agentic: correctness here (the numbers are exactly what Yahoo returned,
not reinterpreted) is what every downstream stage's trustworthiness
depends on.

**Indicator computation** (`scoring/indicators.ts`). Turns raw price bars
into RSI, MACD, SMA, volatility, and the rest -- standard, externally
defined formulas, not anything invented for this project. Agent2's
domain, deterministic by necessity: these are mathematical definitions,
there is no judgment call to make agentic.

**v1 scoring** (`scoring/score.ts`, frozen). A weighted-average composite
from quality, valuation, and momentum. This is actually agent1's policy
domain in substance -- it encodes what "good" means -- but implemented as
fixed code and deliberately frozen per your earlier instruction. Should
it ever move? No. Keeping it frozen is what makes it useful: it is the
one stable yardstick everything else, including every new model agent2
tries, gets compared against. If it moves too, there is nothing fixed
left to measure improvement against.

**Decision Lab factor scoring** (`decision/factors.ts`). Same policy
domain as v1 scoring, but deliberately evolving -- this is where agent1's
"how to analyze" judgment actually lives today, hand-encoded by the two
of us (gating, compounding, conflict-awareness) rather than learned or
reasoned about live. This is the best candidate, if any, for where an
LLM-as-agent1 could eventually play a role -- but as periodic,
human-gated policy review (an occasional session like this one, where an
LLM proposes a change to the banding/weighting logic and you approve it
before it becomes code), not as something that runs live and rewrites
itself unattended. That is a different kind of "agentic" from the
portfolio-analyst endpoint in section 3 below, and worth keeping
separate: agent-assisted engineering (episodic, human-approved, exactly
what this conversation already does) versus an agentic stage inside the
live running system (continuous, unattended, needs its own guardrails).

**NNLS/GBM weight fitting** (`harness.py`). Statistical fitting against
historical data, not judgment -- least squares and gradient boosting
finding best-fit weights given a fixed dataset and fixed hyperparameters.
Agent2's domain, and it should stay algorithmic: the whole point is that
a fit is reproducible and checkable, not a matter of taste.

**The promotion gate** (`promote-weights.ts`). This is the one you
already flagged as not working. As implemented, it requires 3 consecutive
weeks of beating the linear baseline with positive IC before anything
goes live -- and it has never passed a single week in the time we've been
watching it. Agent2's domain (harness/evaluation design), but it is also
where your skepticism should land hardest: a rule that has never once
fired isn't necessarily being appropriately conservative. It could mean
the threshold is miscalibrated for how few tickers and how little history
exist, that the comparison (against a plain linear baseline) is the wrong
bar, or that the known collinearity between factors (debt_to_equity,
ebit, rsi_14 all double-counted across factor boundaries, flagged back in
September) is actively sabotaging every fit before the gate even gets a
chance to evaluate it fairly. This is the actual candidate for the
"reconsider the evaluation" conversation, more than any of the other six
stages.

**The harness as a whole** (`backtest.sh` orchestrating fitting +
evaluation + promotion, run weekly and unattended). 100% agent2's domain
-- it is literally the thing "agent2 creates an appropriate harness for
controlling the system" already describes, and it already exists and
already runs itself. The open question isn't whether it exists, it's
whether its own evaluation criteria (the promotion gate above) are
actually the right ones.

## 3. Where it should become agentic: one narrow, bounded slot

Turning the whole pipeline into a sprawling multi-agent system would be
expensive, harder to debug, and harder to trust than what is there now. A
single new agentic stage, inserted strictly after all deterministic
scoring and never replacing it: a "market analyst" step. Not a portfolio
advisor -- it has no view of your holdings and doesn't need one.

Inputs: the deterministic Decision Lab output for every tracked ticker
(scores, warnings, supporting metrics), the benchmark/index price history
from section 6 (so the model can read a ticker's score in the context of
its own market, not in isolation), and a market-psychology signal (see
below). Not your holdings, not budget, not position sizing.

Job: synthesize across tickers, benchmarks, and factors the way this
conversation has been doing by hand -- which tickers are worth entering
now, for which horizon, and why, cross-checked against how the relevant
benchmark/index is behaving -- and update the ranking list accordingly.
Never a number telling you how much to buy.

(See section 7 for the separate scheduled quality-evaluation loop -- that
one does run on a cron, but it evaluates the system, it doesn't serve you
a ranking, so it's a different endpoint with a different guardrail.)

Market psychology, concretely: start by reusing what's already computed
-- the `catalyst` and `market_regime` factors, plus technical readings
like RSI extremes, already function as a psychology proxy (crowd
positioning, momentum exhaustion, regime shifts) without any new data
source or extra LLM cost. This is the recommended starting point. If that
proxy turns out to be too coarse once you've used it a while, the
extension is a separate, clearly scoped addition: ingest real sentiment
(news headlines or social chatter per ticker, via a news API) and feed it
in as an eleventh factor or as direct input to this same endpoint -- new
data source, new cost, built only if the proxy demonstrably falls short.

Output: structured (a JSON schema), not free text, so it's a reusable
system output rather than a one-off chat answer -- the same shape as
today's score + rank + filtered list, with the synthesis layered on top.
Each claim cites the specific deterministic score/metric behind it, so it
stays auditable instead of becoming a black box.

Guardrail: the model is never allowed to invent or override a factor
score, and never allowed to output a position size, allocation, or order
instruction. It can only synthesize, rank, and explain, strictly after the
deterministic scores already exist.

Where it plugs in: a new endpoint, e.g. `POST /market-analysis`, called on
demand rather than on the hourly/daily schedule -- this answers "what's
worth entering right now, across what I track," not something that needs
to run unattended.

**Future phase, not this one:** position sizing and order placement.
Once this ranking stage is live and trusted, a later, separately-scoped
stage can take the ranked list plus your stated budget and risk limits and
propose (not execute) a position size, and eventually interface with
Avanza or another broker to place the order -- each of those is a
distinct, much higher-stakes guardrail problem (real money moving) and
should be designed on its own, not bundled into this build.

## 4. The "graphs and loops" ask, made concrete

With sizing out of scope, the bounded two-role loop's job changes: it's
no longer checking an allocation against cash and concentration limits
(that logic goes away entirely). Instead it becomes a factual-grounding
loop: an analyst pass drafts the synthesis, then a validator pass checks
every claim in it traces back to an actual score, warning, or metric in
the deterministic data -- no claim is allowed to stand on anything the
model inferred without a verifiable number behind it. A claim that can't
be traced gets kicked back with the specific violation; repeat to a
max-iteration cap, then return. This is what keeps the agentic layer from
drifting into confident-sounding but ungrounded narrative.

## 5. What this actually costs

Current official Anthropic API pricing (per million tokens):

| Model | Input | Output |
|---|---|---|
| Haiku 5.5 (prompts under 100K tokens) | $0.10 | $0.50 |
| Sonnet 5.5 | $2.00 | $10.00 |
| Opus 5.5 | $4.00 | $20.00 |

Batch processing (non-time-sensitive calls) is a flat 50% off any of the
above.

For this specific call shape -- structured scores/warnings for the
tracked universe plus your holdings as input (roughly 5,000-8,000 tokens
for a few dozen tickers), a structured synthesis as output (roughly
500-1,500 tokens) -- a single call on Sonnet 5.5 comes to a little over
2 US cents; on Haiku 5.5, closer to a tenth of a cent. Since this is
on-demand (you asking, not an hourly cron), even calling it several times
a day would stay well under a dollar a month. The real cost driver isn't
the per-call price, it's whether the endpoint can be hit by anyone who
finds the URL -- which is exactly what the `ADMIN_TOKEN` gate already
used for `/ingest` and `/score` is for here: without it, an unauthenticated
endpoint making paid LLM calls is an open invitation to run up a real
bill, not just a security gap.

Mechanics: a Cloudflare Worker has no LLM built in, so this is a plain
`fetch()` from inside the Worker's handler to `api.anthropic.com`, with
the `ANTHROPIC_API_KEY` stored as a Workers secret (`wrangler secret
put`, same pattern as `ADMIN_TOKEN` already uses) and the request gated
behind that same admin token before the Worker ever makes the paid call.

**Worst-case monthly ceiling.** The factual-grounding loop in section 4
caps at a fixed number of iterations (proposed: 3), so one
`/portfolio-advice` call costs at most that many LLM calls, not an
unbounded number. Using a generous per-call estimate (15,000 input +
3,000 output tokens on Sonnet 5.5, to allow for a larger universe than
today's), one request tops out around $0.06 per iteration, so roughly
$0.18 for a single fully-retried request. Even at 5 manually-triggered
requests a day, every single day, that's under $30/month -- and that
scenario assumes you're calling it far more often than "what should I
pay attention to right now" naturally would be. Realistic usage (a few
times a week) lands closer to $1-5/month.

The actual hard ceiling, independent of any of this math or any bug in
the code, is whatever spend limit you set directly in the Anthropic
Console's billing settings -- the API simply stops serving requests once
that's hit, rather than continuing to bill. That's the backstop worth
relying on, not the usage estimate above.

## 6. Benchmarks

The index list you pasted closes two gaps flagged earlier this year: the
live market-regime factor currently reads only SPY as its one proxy for
"the market," and the backtest harness compares portfolio performance
against the tracked universe's own equal-weighted average rather than a
real index, since no benchmark price history is persisted anywhere. This
is no longer a nice-to-have for backtesting alone -- section 3's
market-analysis endpoint needs this same benchmark data as a live input,
so it's now a prerequisite for that endpoint, not an independent
improvement.

Fix: ingest price history for the actual home-market benchmark per
ticker -- OMX Stockholm 30 for Nordic/Avanza-listed tickers, S&P 500 or
Nasdaq Composite for US tickers, the relevant regional index for anything
else in the universe. This uses the same Yahoo Finance chart endpoint
already used for every other ticker (no new data source), just a handful
of extra index tickers to track (e.g. `^GSPC`, `^IXIC`, `^OMX`).

## 7. Scheduled quality-evaluation loop (the one piece that does run on a cron)

Separate from the on-demand market-analyst endpoint: a recurring check on
whether the system itself -- live scoring, the weekly harness, the
promotion gate -- is behaving correctly, now with authority to act on
what it finds rather than just report it. Two tiers:

**Daily, deterministic, no LLM.** Unchanged: piggybacks on the existing
daily full run (06:00 UTC). Checks for NaN/null scores, a factor stuck at
an identical value across every ticker, out-of-bounds values, incomplete
ingestion. Free, no LLM call.

**Once a week, LLM-assisted evaluation and correction.** Timed for
Sunday, around 12:00-13:00 UTC -- a few hours after the existing
`backtest.yml` cron fires at 08:00 UTC, giving its ~3-hour walk-forward
fitting job room to actually finish before this evaluates it. Evaluating
more often than the harness itself re-fits (weekly) would mostly mean
re-reading the same numbers, so once a week, right after fresh data
exists, is the effective cadence -- not twice. Inputs: latest harness run
(IC per model/horizon, `beats_linear`, promotion streak), live factor
weights/config, and the week's daily-check log.

**Two agents, not one, before anything is applied.** An evaluator agent
assesses quality and drafts the best concrete recommendation (e.g. "split
`debt_to_equity` out of `factor_risk`, keep it only in
`factor_financial_strength`"). A second, independent verifier agent then
checks that specific recommendation -- does it actually address the
evidence, is it internally consistent, does it avoid introducing a new
problem (e.g. breaking a different factor) -- and can revise or reject
it before it goes anywhere near the live system. Only the verifier's
cleared version, if any, gets applied. This mirrors the draft-then-check
pattern already used for the on-demand endpoint's fact-grounding loop
(section 4), applied here to correction proposals instead of synthesis
claims.

**Mechanics -- this runs as a Claude scheduled task, not a Worker-side
LLM call.** Telegram is dropped; "push notification wherever Claude is
running" is exactly what a Claude scheduled task's own push-notification
setting already does -- no new bot, no new secret. Concretely: a weekly
scheduled task (Sunday ~12:00-13:00 UTC, push notifications on, approval
mode set to automatic so it can act without someone present to approve)
fires, reads the harness/scores/daily-check history from new admin-only
Worker endpoints (`GET /admin/quality-report`), runs the evaluator-then-
verifier pass above, and if a correction clears verification, applies it
via `POST /admin/apply-correction` -- the Worker writes the new value to
D1 **and** logs the prior value with a timestamp and correction ID to a
`correction_history` table before overwriting it. The session then sends
you a push notification stating what was changed, why, and the
correction ID.

**Rollback, not pre-approval by you.** The correction is live immediately
once the verifier clears it; you review after the fact and decide
whether to undo it anyway. `POST /admin/rollback/<correction_id>`
restores the exact prior value from `correction_history` -- a single
call, no manual D1 surgery. The two-agent check reduces the chance of a
bad correction reaching production, but doesn't eliminate the need for
your own check -- the rollback path stays the actual safety net. If it
ever proves too loose in practice (e.g. a bad correction sits live for
days before you notice), tightening it to approve-before-apply by you
is a one-line change to this section, not a rebuild.

**Cost, and a different billing line than you'd expect.** This no longer
calls the Anthropic API from inside the Worker -- it runs as a Claude
scheduled task, so it draws on your existing Claude/Cowork usage, not the
separate Anthropic Console API spend cap that the on-demand market-
analyst endpoint uses. One session a week, running two agent passes and
occasionally writing one correction, is a small addition to normal
usage -- not a new dollar figure to track against the $10 API ceiling.

## 8. Universe discovery: finding tickers worth tracking, not just scoring the ones already picked

The gap you flagged: `config/universe.json` is a small, static, hand-picked
list. A name like Campbell or Bristol Myers Squibb -- or whatever
Morningstar, Seeking Alpha, or a forum is currently flagging as
undervalued -- simply cannot be scored, ranked, or surfaced if it was
never added to that file by a person. Every section above, including the
new market-analyst endpoint, only ever ranks what's already on the list.
Widening the list is a separate, upstream problem from everything else in
this document, and the one most directly tied to "there are better
opportunities I'm not seeing."

**Fix: ingest full index constituents, not more hand-picked names.**
Rather than manually adding Campbell, Bristol Myers Squibb, and whatever
else comes up next, pull the full constituent list of a real index (S&P
500 as the base, optionally extended to S&P 400 MidCap and relevant OMX
Stockholm names given your Avanza exposure) and feed those symbols into
the same Yahoo Finance ingestion pipeline already in use -- no new
fundamentals data source, just more symbols. Index membership changes a
handful of times a year, so the constituent list itself can be a small,
occasionally-refreshed file (e.g. from a maintained public table), not a
live dependency. Both of your named examples are S&P 500 members today,
so they'd be covered automatically the moment this exists -- no one has
to remember to add them, or the next one that comes up.

**The cost problem this creates, and the fix for that: a two-stage
funnel.** Running the full Decision Lab pipeline (all 10 factors,
indicator computation, benchmark comparison) on hundreds of tickers
instead of ~20-30 would multiply ingestion time, API calls, and D1
storage directly. So split it:

- **Stage A -- cheap broad screen.** For every ticker in the wide
  universe, pull only lightweight data (price, basic valuation ratios --
  P/E, P/B, EV/EBITDA -- and simple momentum), not the full fundamentals/
  indicator pipeline. Apply the percentile-based screening already
  recommended in the factors/scoring assessment to cut hundreds of names
  down to a shortlist (e.g. the top 5-10%, or a fixed shortlist size).
  This is exactly the kind of screen that surfaces a discounted, unfamous
  name on its own numbers -- not because an analyst happened to mention
  it.
- **Stage B -- full Decision Lab treatment, shortlist only.** Only
  Stage A's survivors get the complete pipeline -- same cost profile as
  today, just applied to a rotating, discovery-driven shortlist instead
  of a fixed list that never changes unless someone edits a file.

**Where this plugs into the existing schedule.** Stage A can run on its
own, separate cadence (e.g. weekly -- cheap valuation/momentum screening
doesn't need to be as fresh as live scoring) without touching the
existing daily/hourly cron, which keeps running the full pipeline only on
whatever Stage A currently shortlists. This keeps the existing job's
runtime from scaling with the size of the broad universe.

**What this deliberately doesn't do:** scrape Morningstar or Seeking
Alpha directly for their specific calls. That data sits behind rate
limits and terms of service that make it an unreliable foundation to
build on. The two-stage funnel using the same Yahoo-Finance-sourced
numbers the system already trusts, plus its own percentile-based scoring,
produces the same kind of signal -- genuinely cheap/undervalued names
surfacing on their own merits -- without depending on a third party's
site staying scrapeable.

**Cloudflare limits this has to design around (checked against current
docs):**

- Subrequests per invocation: 50 on the Workers free plan, 10,000 on
  Workers Paid. Today's ~20-30 tickers, each needing several Yahoo
  Finance fetches, almost certainly already requires Paid. At S&P 500
  scale (~500 tickers x ~4 fetches) that's roughly 2,000 subrequests --
  comfortably under Paid's 10,000, not viable on Free.
- CPU time for Cron Triggers depends on the interval: under 1 hour gets
  only 30 seconds of CPU time even on Paid; 1 hour or longer gets 15
  minutes. The existing hourly incremental cron sits in the 30-second
  tier -- it must stay scoped to the current shortlist and never touch
  the widened universe. The daily cron (06:00 UTC, >=1hr interval)
  qualifies for the 15-minute tier, so that's where Stage A's broad
  screen belongs.
- Wall time: 15 minutes maximum per scheduled invocation, regardless of
  CPU budget. Screening hundreds of tickers needs batched/concurrent
  fetches to fit inside that window -- workable at S&P 500 + S&P 400 +
  OMX scale, a real ceiling if the universe grows much further.
- D1: not a real constraint here -- 10 GB database size and unlimited
  rows per table on Paid. The only thing to respect is 100 bound
  parameters per query and 1,000 queries per invocation, which just
  means writing the broad screen's results through `db.batch()` rather
  than one `INSERT` per ticker.

## 9. What still needs a decision before anything gets built

Resolved this round:

- Scope: narrow build first (market-analyst-plus-validator loop), with a
  staged extension plan -- a later human-gated policy-review phase, then
  separately-scoped position-sizing and order-placement phases. Not a
  broader agent1/agent2-everywhere rewrite.
- Holdings: not used by this stage at all. Dropped from scope, not
  deferred -- the system ranks the tracked universe/benchmarks, it does
  not advise on your specific positions.
- Run mode for the market-analyst endpoint: on-demand, not a scheduled
  cron step.
- Market psychology: start with the existing catalyst/market_regime/
  technical factors as the proxy; real sentiment ingestion (news API) is
  a scoped future extension, built only if the proxy proves too coarse.
- A second, separate piece does run on a schedule: the quality-evaluation
  loop in section 7 (daily deterministic checks, once-weekly LLM
  evaluation with an evaluator-then-verifier pass, corrections applied
  immediately with logged rollback rather than staged for pre-approval,
  push notification instead of Telegram, running as a Claude scheduled
  task rather than a Worker-side Anthropic API call).
- Build order (this was the "still open" item -- resolved now into a
  plain sequence instead of an abstract tradeoff):
  1. Benchmark/index ingestion (section 6). Small, self-contained, and a
     prerequisite for both new pieces below -- do it first regardless of
     what else happens.
  2. Universe widening + the two-stage screening funnel (section 8).
     Independent of the dedup fix below (different domain -- what gets
     tracked, not how it's scored), so it can be done in parallel with
     step 3, but it's sequenced early because it's the gap you just
     flagged and the one most directly tied to missing actual
     opportunities, not an internal quality issue.
  3. The raw-input dedup / collinearity fix (already scoped: split
     `debt_to_equity`, `ebit`, and `rsi_14` out of whichever factor
     they're double-counted in). Do this before building the new LLM
     pieces, not after -- otherwise the first several runs of the new
     weekly evaluator would just be re-discovering and re-recommending a
     fix we've already identified and already decided how to make,
     which wastes its first few cycles on something already solved.
  4. The on-demand market-analyst endpoint (section 3) -- the one you
     call yourself, whenever you want a fresh read. `POST
     /market-analysis`, `ADMIN_TOKEN`-gated, no schedule, no holdings
     input -- you hit it, it reads the current Decision Lab scores and
     benchmarks, and returns a ranked, filtered list per horizon with
     each claim traced to a real score. Nothing to wait for; it runs the
     moment you ask. By this point it's also drawing on the widened
     universe from step 2, not just the original ~20-30 tickers.
  5. The scheduled quality-evaluation/correction loop (section 7) --
     built last because it depends on the earlier steps (benchmark data,
     a cleaner factor set, a wider universe to evaluate) and is the
     highest-stakes piece (it can change live scoring on its own).
</content>
