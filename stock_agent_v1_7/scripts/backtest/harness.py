#!/usr/bin/env python3
"""Walk-forward backtest harness -- v7 Model Selection & Testing.

Compares three candidate models (regularized linear regression, gradient-
boosted trees, TabPFN) on the point-in-time technical-feature dataset built
by build-dataset.ts, using the methodology described on the /decision-lab
page's Methodology -> Model Selection & Testing tab:

  * Expanding walk-forward, never a random/shuffled split -- a model is
    only ever tested on a calendar period strictly after everything it was
    trained on.
  * An embargo gap at each train/test boundary sized to the horizon's
    forward-return window, so a training row's label can never peek across
    the boundary into the test period.
  * A final holdout (the most recent HOLDOUT_QUARTERS quarters) that is
    NEVER used for training or model selection during the walk-forward
    loop -- evaluated exactly once, at the end, as the one number that
    counts.
  * Metrics: hit rate, rank correlation (information coefficient) against
    realized forward return, and a simple top-K portfolio simulation
    (Sharpe, max drawdown) against an equal-weighted-universe benchmark.
    NOTE: SPY itself is deliberately never written to price_history (see
    src/decision/run.ts's market-regime proxy comment) -- there is no
    stored SPY history to benchmark against yet, so this uses the
    universe's own equal-weighted average return as the benchmark instead
    of a true index. Persisting SPY history would be a future ingestion
    change, not something this script can do with data that exists today.
  * A bootstrap significance check on every candidate vs. the linear
    baseline, because with a limited number of tickers a fancier model can
    look better than the baseline by pure chance -- a "win" has to survive
    this before it's trusted.

Per horizon, also computes three interpretability views (feature
importance, feature/label correlations, partial dependence) so the model
comparison table isn't the only thing you can see -- see
compute_correlations, compute_feature_importance, and
compute_partial_dependence below. These describe/explain the SAME final
holdout fit above, not a separate model.

Linear and GBM's hyperparameters are no longer fixed -- see inner_tune
below for a NESTED walk-forward search, re-run inside every outer fold and
again for the final holdout, so the chosen config can shift as more
history (and different market patterns) accumulate rather than being
frozen at one guess forever. Each fold's choice is recorded (see the
"tuning" key in run_horizon's return value) so you can actually see
whether/how it adapted, not just trust that it did.

Known, stated limitation (see the Methodology tab's "Known limits"): this
harness only covers the technical/price-based factors, which have genuine
point-in-time history. Fundamentals-driven factors are not included here --
see the Methodology tab for why.

Also fits Decision Lab's ACTUAL weight vector -- not a standalone technical
model evaluated next to it, the real non-negative/sum-to-1 weights over the
4 live factors that have point-in-time history today (entry, technical, a
partial valuation, a partial risk -- see build-dataset.ts and
DECISION_FACTORS below) via non-negative least squares, walk-forward,
same discipline as everything else here. See fit_decision_weights and the
"decision_weights" entry in each horizon's report. This is evaluated
alongside linear/gbm/tabpfn (same IC/hit-rate/significance/holdout checks)
but is NOT yet wired into the live engine -- it still needs the promotion
gate (repeated, not one-off, passes before a fitted vector replaces
src/decision/weights.ts's DEFAULT_WEIGHTS) that hasn't been built yet.

Usage:
    python3 scripts/backtest/harness.py [--dataset data/backtest_dataset.csv]
                                         [--out-json data/backtest_report.json]
                                         [--out-md data/backtest_report.md]
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from scipy.optimize import nnls
from sklearn.linear_model import Ridge
from sklearn.ensemble import GradientBoostingRegressor

FEATURES = [
    "rsi14", "macd", "macd_signal", "price_vs_sma50", "price_vs_sma200",
    "volatility_30d", "volume_trend_20d", "price_range_pct", "dist_from_high_pct", "dist_from_low_pct",
    "trend_pullback", "trend_near_high", "trend_downtrend", "trend_neutral",
]
LABEL = "label_forward_return"

# The actual trainable-Decision-Lab piece: 4 of the 10 live factors
# (entry, technical, a partial valuation, a partial risk -- see
# build-dataset.ts's comment on why only these 4 have point-in-time
# history today) fit as a real non-negative, sum-to-1 weight vector against
# real realized forward returns, walk-forward, same discipline as
# linear/gbm above. This is what actually answers "does the model correct
# its own weights from being wrong" for the live Decision Lab engine,
# rather than just evaluating a disconnected technical-only model next to
# it. The other 6 factors (quality, growth, financial_strength,
# future_potential, catalyst, market_regime) are not included here yet --
# they need fundamentals/news history that's only just started
# accumulating (see src/lib/db.ts pruneOldSnapshots) -- extend
# DECISION_FACTORS once that history is deep enough to fit against without
# lookahead bias.
DECISION_FACTORS = ["factor_entry", "factor_technical", "factor_valuation_partial", "factor_risk_partial"]

HORIZON_DAYS = {"short": 10, "medium": 60, "long": 252}
HOLDOUT_QUARTERS = 2       # ~6 months, never touched until the final report
MIN_TRAIN_QUARTERS = 4     # don't start walk-forward testing until this much history exists
N_BOOTSTRAP = 1000
TOP_K = 3

try:
    from tabpfn import TabPFNRegressor  # type: ignore
    TABPFN_AVAILABLE = True
except Exception as exc:  # pragma: no cover -- degrade gracefully, don't crash the harness
    TABPFN_AVAILABLE = False
    TABPFN_IMPORT_ERROR = str(exc)


@dataclass
class FoldMetrics:
    hit_rate: float | None
    ic: float | None
    n: int
    portfolio_returns: list[float] = field(default_factory=list)  # one per test date, top-K mean actual return
    benchmark_returns: list[float] = field(default_factory=list)  # one per test date, equal-weighted universe mean


def quarter_of(date_series: pd.Series) -> pd.Series:
    dt = pd.to_datetime(date_series)
    return dt.dt.to_period("Q")


def make_model(name: str):
    if name == "linear":
        return Ridge(alpha=1.0)
    if name == "gbm":
        return GradientBoostingRegressor(max_depth=3, n_estimators=60, learning_rate=0.05, subsample=0.8, random_state=0)
    if name == "tabpfn":
        if not TABPFN_AVAILABLE:
            return None
        return TabPFNRegressor()
    raise ValueError(name)


# --- Automatic hyperparameter tuning ------------------------------------
#
# Fixed hyperparameters (Ridge's alpha=1.0, GBM's depth=3/n_estimators=60/
# lr=0.05 above) were never actually tuned against this data -- they were
# just a reasonable starting guess. That's a real gap: "testing" was real
# (the walk-forward/holdout methodology), "tuning" wasn't. This section
# closes it with a NESTED walk-forward search, re-run inside every outer
# fold (and again for the final holdout), so the chosen hyperparameters
# can shift as more history -- and different market patterns -- accumulate,
# rather than being frozen once at the start. TabPFN has no comparable
# hyperparameters to search (it's used as a pretrained model, not trained
# from scratch), so it's untouched by any of this.
DEFAULT_PARAMS = {"linear": {"alpha": 1.0}, "gbm": {"max_depth": 3, "learning_rate": 0.05, "n_estimators": 60}}
LINEAR_GRID = [{"alpha": a} for a in [0.1, 1.0, 5.0, 20.0, 100.0]]
GBM_GRID = [
    {"max_depth": 2, "learning_rate": 0.05, "n_estimators": 60},
    {"max_depth": 2, "learning_rate": 0.10, "n_estimators": 60},
    {"max_depth": 3, "learning_rate": 0.05, "n_estimators": 60},
    {"max_depth": 3, "learning_rate": 0.10, "n_estimators": 60},
]
# Grid-searching itself doesn't need every row -- it only needs enough to
# rank candidates against each other -- so large inner-training windows
# are subsampled just for this search (fixed seed, so it's reproducible
# fold to fold). The FINAL model actually used for the fold's test/holdout
# is always refit on the full training window, never the subsample.
INNER_TUNE_MAX_ROWS = 20000
# Set from --no-tune in main(); a module-level switch (rather than
# threading a flag through every call site) so inner_tune can bail out to
# the fixed default immediately when tuning is off, without every caller
# needing to know or care.
TUNING_ENABLED = True


def make_model_with_params(name: str, params: dict):
    if name == "linear":
        return Ridge(alpha=params["alpha"])
    if name == "gbm":
        return GradientBoostingRegressor(
            max_depth=params["max_depth"], n_estimators=params["n_estimators"],
            learning_rate=params["learning_rate"], subsample=0.8, random_state=0,
        )
    raise ValueError(name)


def candidate_grid(model_name: str) -> list[dict]:
    if model_name == "linear":
        return LINEAR_GRID
    if model_name == "gbm":
        return GBM_GRID
    return []


def inner_tune(model_name: str, train: pd.DataFrame, embargo_days: int):
    """Searches candidate_grid(model_name) using an INNER walk-forward
    split carved out of `train` itself -- the most recent quarter inside
    the training window becomes an inner validation slice (with the same
    embargo gap as the outer split), everything before it becomes the
    inner training slice. No lookahead: every row used here already sits
    inside the outer fold's own training window, so nothing from the
    actual test/holdout period is ever touched.

    Returns (chosen_params, inner_validation_ic, all_candidates_scored).
    Falls back to DEFAULT_PARAMS (no search) when there isn't yet enough
    history inside `train` to carve out a meaningful inner validation
    slice -- early folds get the sensible default; real tuning kicks in
    once enough data has accumulated to validate against, which is what
    lets the chosen hyperparameters actually track new patterns as more
    history comes in rather than guessing blind on too little data."""
    grid = candidate_grid(model_name)
    if not TUNING_ENABLED or not grid or "quarter" not in train.columns:
        return DEFAULT_PARAMS.get(model_name, {}), None, []

    inner_quarters = sorted(train["quarter"].unique())
    if len(inner_quarters) < 2:
        return DEFAULT_PARAMS.get(model_name, {}), None, []

    inner_test_q = inner_quarters[-1]
    inner_test = train[train["quarter"] == inner_test_q]
    if inner_test.empty:
        return DEFAULT_PARAMS.get(model_name, {}), None, []
    inner_test_start = pd.to_datetime(inner_test["date"]).min()
    inner_cutoff = inner_test_start - pd.Timedelta(days=int(embargo_days * 1.5))
    inner_train = train[pd.to_datetime(train["date"]) < inner_cutoff]
    if len(inner_train) < 30:
        return DEFAULT_PARAMS.get(model_name, {}), None, []
    if len(inner_train) > INNER_TUNE_MAX_ROWS:
        inner_train = inner_train.sample(n=INNER_TUNE_MAX_ROWS, random_state=0)

    scored = []
    for params in grid:
        try:
            model = make_model_with_params(model_name, params)
            model.fit(inner_train[FEATURES].to_numpy(), inner_train[LABEL].to_numpy())
            preds = model.predict(inner_test[FEATURES].to_numpy())
        except Exception:  # pragma: no cover -- a bad candidate just loses, doesn't crash tuning
            continue
        ic = quick_ic(inner_test, preds)
        if ic is None:
            continue
        scored.append((ic, params))
    if not scored:
        return DEFAULT_PARAMS.get(model_name, {}), None, []

    scored.sort(key=lambda t: t[0], reverse=True)
    best_ic, best_params = scored[0]
    ranked = [{"params": p, "inner_validation_ic": round(float(ic), 4)} for ic, p in scored]
    return best_params, round(float(best_ic), 4), ranked


def fit_model_with_params(model_name: str, params: dict, train: pd.DataFrame):
    try:
        model = make_model_with_params(model_name, params)
        model.fit(train[FEATURES].to_numpy(), train[LABEL].to_numpy())
        return model
    except Exception as exc:  # pragma: no cover
        print(f"  [{model_name}] tuned fit failed: {exc}", file=sys.stderr)
        return None


def fit_predict(model_name: str, train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray | None:
    model = make_model(model_name)
    if model is None:
        return None
    X_train, y_train = train[FEATURES].to_numpy(), train[LABEL].to_numpy()
    X_test = test[FEATURES].to_numpy()
    if model_name == "tabpfn":
        # TabPFN is priors-fitted for small-N tabular problems -- guard the
        # sizes it's actually validated for rather than silently truncating.
        if len(X_train) > 10000 or X_train.shape[1] > 500:
            return None
    try:
        model.fit(X_train, y_train)
        return model.predict(X_test)
    except Exception as exc:  # pragma: no cover
        print(f"  [{model_name}] fit/predict failed, skipping this fold: {exc}", file=sys.stderr)
        return None


def fit_model_only(model_name: str, train: pd.DataFrame):
    """Same fit logic/guards as fit_predict, but returns the fitted model
    object itself rather than just predictions -- needed for feature
    importance and partial dependence, which read the model's internals,
    not just its outputs. Only ever called once per model on the final
    holdout's full training window (see run_horizon), not per fold -- the
    walk-forward loop itself still uses fit_predict unchanged."""
    model = make_model(model_name)
    if model is None:
        return None
    X_train, y_train = train[FEATURES].to_numpy(), train[LABEL].to_numpy()
    if model_name == "tabpfn" and (len(X_train) > 10000 or X_train.shape[1] > 500):
        return None
    try:
        model.fit(X_train, y_train)
        return model
    except Exception as exc:  # pragma: no cover
        print(f"  [{model_name}] fit failed, skipping: {exc}", file=sys.stderr)
        return None


def fit_decision_weights(train: pd.DataFrame) -> np.ndarray | None:
    """Fits Decision Lab's actual weight vector -- non-negative, summing to
    1, exactly the shape validateWeights() in src/decision/types.ts
    requires -- against real realized forward returns via non-negative
    least squares (scipy.optimize.nnls). This is the literal "learn from
    being wrong" step: nnls finds the weight combination that minimizes
    squared prediction error on this training window, so a factor that
    turns out not to predict returns gets pushed toward a near-zero
    weight, and one that does gets a larger one -- nothing here is
    hand-picked. Returns None if there isn't enough clean training data
    to fit against (mirrors inner_tune's same guard)."""
    sub = train.dropna(subset=DECISION_FACTORS + [LABEL])
    if len(sub) < 30:
        return None
    X = sub[DECISION_FACTORS].to_numpy()
    y = sub[LABEL].to_numpy()
    try:
        w, _residual = nnls(X, y)
    except Exception:  # pragma: no cover -- a failed fit just skips this fold, doesn't crash the harness
        return None
    total = w.sum()
    # total == 0 means nnls found no non-negative combination of these 4
    # factors that beats predicting zero for everyone -- an honest "no
    # signal this fold" result, not an error. Left un-normalized (all
    # zeros); predictions from it are also all zero, which evaluate_fold's
    # rank-correlation step correctly reports as no usable signal (NaN,
    # filtered out) rather than a fake ranking.
    return w / total if total > 0 else w


def compute_correlations(hdf: pd.DataFrame) -> dict:
    """Pearson correlation between every technical feature and every other
    feature, AND between every feature and the realized forward return --
    the "which inputs move together, which ones actually predict the
    label" view. Computed over all available (non-holdout-excluded) rows
    for this horizon; this is descriptive of the data, not a trained
    model, so there's no leakage concern in using the full history the way
    there would be for an evaluation metric."""
    cols = FEATURES + [LABEL]
    sub = hdf[cols].dropna()
    if len(sub) < 30:
        return {"labels": cols, "matrix": None, "n": len(sub)}
    corr = sub.corr(method="pearson")
    matrix = [[None if pd.isna(v) else round(float(v), 3) for v in row] for row in corr.values]
    return {"labels": cols, "matrix": matrix, "n": len(sub)}


def compute_feature_importance(models: dict, train_all: pd.DataFrame) -> dict:
    """Which technical inputs each model actually leaned on, extracted
    from the model's own internals -- not a guess. GBM: sklearn's built-in
    impurity-based feature_importances_ (already normalized to sum to 1).
    Linear: |coefficient| scaled by that feature's own training-set stdev
    (a standardized-coefficient approximation -- raw Ridge coefficients
    aren't comparable across features that live on very different scales,
    e.g. RSI 0-100 vs. a one-hot 0/1 flag), then normalized the same way
    for a like-for-like comparison against GBM's chart. TabPFN isn't
    included here -- it has no simple global-importance readout (see the
    Methodology tab's "more of a black box" note on TabPFN)."""
    out: dict = {}
    if "linear" in models and models["linear"] is not None:
        stds = train_all[FEATURES].std().to_numpy()
        raw = np.abs(models["linear"].coef_ * stds)
        total = raw.sum()
        norm = raw / total if total > 0 else raw
        out["linear"] = [{"feature": f, "importance": round(float(v), 4)} for f, v in zip(FEATURES, norm)]
    if "gbm" in models and models["gbm"] is not None:
        raw = models["gbm"].feature_importances_
        out["gbm"] = [{"feature": f, "importance": round(float(v), 4)} for f, v in zip(FEATURES, raw)]
    return out


def compute_partial_dependence(gbm_model, train_all: pd.DataFrame, grid_points: int = 9) -> dict:
    """For the GBM model only (see module docstring on why): for each
    feature, hold every OTHER feature at its training-set median and sweep
    just that one feature across its own 5th-95th percentile range,
    reading the model's prediction at each point. This is what actually
    shows "interaction with the model," as opposed to a raw correlation --
    it's the model's own learned response curve for that input, isolated
    from the others. A flat curve means the model essentially ignores that
    feature; a curve that doesn't match the intuitive assumption (e.g. RSI
    scoring best away from 50) is worth knowing before trusting the model."""
    if gbm_model is None:
        return {}
    baseline = train_all[FEATURES].median()
    out: dict = {}
    for f in FEATURES:
        col = train_all[f].dropna()
        if col.empty:
            continue
        grid = np.unique(np.percentile(col.to_numpy(), np.linspace(5, 95, grid_points)))
        rows = np.tile(baseline.to_numpy(), (len(grid), 1))
        f_idx = FEATURES.index(f)
        rows[:, f_idx] = grid
        preds = gbm_model.predict(rows)
        out[f] = [{"x": round(float(x), 4), "y": round(float(y), 5)} for x, y in zip(grid, preds)]
    return out


def quick_ic(test: pd.DataFrame, preds: np.ndarray) -> float | None:
    """IC only, skipping evaluate_fold's top-K portfolio simulation
    (per-date `nlargest`, which profiling showed as the dominant cost of
    the whole harness once hyperparameter search calls evaluate_fold
    dozens of times per fold -- a ~9x-per-fold, unnecessary expense when
    all a candidate hyperparameter set needs is a ranking signal). Used
    ONLY inside inner_tune; every number that actually gets reported
    (walk-forward summary, holdout, significance) still goes through the
    real evaluate_fold, unchanged."""
    df = test.copy()
    df["pred"] = preds
    valid = df[df[LABEL].notna()]
    if valid.empty:
        return None
    ics = []
    for _, grp in valid.groupby("date"):
        if len(grp) < 3:
            continue
        rho, _ = spearmanr(grp["pred"], grp[LABEL])
        if not np.isnan(rho):
            ics.append(rho)
    return float(np.mean(ics)) if ics else None


def evaluate_fold(test: pd.DataFrame, preds: np.ndarray) -> FoldMetrics:
    df = test.copy()
    df["pred"] = preds
    valid = df[df[LABEL].notna()]
    if valid.empty:
        return FoldMetrics(None, None, 0)

    hit_rate = float((np.sign(valid["pred"]) == np.sign(valid[LABEL])).mean())

    ics = []
    for _, grp in valid.groupby("date"):
        if len(grp) < 3:
            continue
        rho, _ = spearmanr(grp["pred"], grp[LABEL])
        if not np.isnan(rho):
            ics.append(rho)
    ic = float(np.mean(ics)) if ics else None

    # Portfolio: mean actual return of the top-K predicted tickers per date.
    # Benchmark: equal-weighted mean actual return of EVERY ticker with a
    # valid row that date -- see the module docstring on why this stands in
    # for a true SPY benchmark (no persisted SPY history exists yet).
    portfolio_returns, benchmark_returns = [], []
    for date, grp in valid.groupby("date"):
        top = grp.nlargest(min(TOP_K, len(grp)), "pred")
        portfolio_returns.append(float(top[LABEL].mean()))
        benchmark_returns.append(float(grp[LABEL].mean()))

    return FoldMetrics(hit_rate, ic, len(valid), portfolio_returns, benchmark_returns)


def sharpe_and_drawdown(returns: list[float]) -> tuple[float | None, float | None]:
    if len(returns) < 2:
        return None, None
    r = np.array(returns)
    if r.std(ddof=1) == 0:
        return None, None
    sharpe = float(r.mean() / r.std(ddof=1) * np.sqrt(252 / max(1, len(r))))  # rough annualization, period-count based
    cum = np.cumprod(1 + r)
    running_max = np.maximum.accumulate(cum)
    drawdown = (cum - running_max) / running_max
    return sharpe, float(drawdown.min())


def bootstrap_pvalue(a: list[float], b: list[float], n: int = N_BOOTSTRAP, seed: int = 0) -> float | None:
    """One-sided bootstrap check: fraction of resamples where model `a`'s
    mean metric does NOT exceed baseline `b`'s -- a rough p-value stand-in.
    Paired on index (same test dates/rows), not independent resampling."""
    if len(a) != len(b) or len(a) < 5:
        return None
    rng = np.random.default_rng(seed)
    a_arr, b_arr = np.array(a), np.array(b)
    diffs = a_arr - b_arr
    n_obs = len(diffs)
    boot_means = np.empty(n)
    for i in range(n):
        idx = rng.integers(0, n_obs, n_obs)
        boot_means[i] = diffs[idx].mean()
    return float((boot_means <= 0).mean())


def evaluate_live_active_weights(test_all: pd.DataFrame, active_weights: dict | None) -> dict | None:
    """Evaluates the CURRENTLY ACTIVE (frozen, not refit) Decision Lab
    weight vector for this horizon on this run's holdout data -- a
    different question from decision_weights above ("would a fresh fit
    pass"), this is "is what's actually live right now still working."
    `active_weights` is the {factor_column: weight} dict for this horizon
    from data/.active_decision_weights.json (see fetch-active-weights.ts),
    or None if D1 had no active row for this horizon (fresh install) --
    returns None in that case, meaning "not monitored this run", not "0
    factors" or a failure."""
    if not active_weights:
        return None
    eval_test = test_all.dropna(subset=DECISION_FACTORS)
    if eval_test.empty:
        return None
    w = np.array([active_weights.get(c, 0.0) for c in DECISION_FACTORS])
    preds = eval_test[DECISION_FACTORS].to_numpy() @ w
    fm = evaluate_fold(eval_test, preds)
    return {"ic": fm.ic, "hit_rate": fm.hit_rate, "n": fm.n}


def run_horizon(df: pd.DataFrame, horizon: str, active_weights: dict | None = None) -> dict:
    hdf = df[df["horizon"] == horizon].copy()
    hdf["quarter"] = quarter_of(hdf["date"])
    quarters = sorted(hdf["quarter"].unique())
    if len(quarters) < MIN_TRAIN_QUARTERS + HOLDOUT_QUARTERS + 1:
        return {"horizon": horizon, "skipped": True, "reason": f"only {len(quarters)} quarters of data -- need at least {MIN_TRAIN_QUARTERS + HOLDOUT_QUARTERS + 1}"}

    holdout_quarters = quarters[-HOLDOUT_QUARTERS:]
    walk_quarters = quarters[:-HOLDOUT_QUARTERS]

    embargo_days = HORIZON_DAYS[horizon]
    model_names = ["linear", "gbm", "decision_weights"] + (["tabpfn"] if TABPFN_AVAILABLE else [])

    fold_metrics: dict[str, list[FoldMetrics]] = {m: [] for m in model_names}
    fold_portfolios: dict[str, list[float]] = {m: [] for m in model_names}
    fold_benchmarks: dict[str, list[float]] = {m: [] for m in model_names}
    # Per-fold record of which hyperparameters got chosen, for linear/gbm
    # only -- this IS the "tuning adapts to new patterns over time" record:
    # read fold to fold, it shows whether/how the chosen config actually
    # shifted as more history accumulated. See the Model Results tab.
    tuning_history: dict[str, list[dict]] = {m: [] for m in model_names if m in ("linear", "gbm")}
    # Same idea, for decision_weights -- the fitted 4-factor Decision Lab
    # weight vector, per fold, so you can see it actually move as more
    # history accumulates rather than trusting that it does.
    decision_weight_history: list[dict] = []

    for i in range(MIN_TRAIN_QUARTERS, len(walk_quarters)):
        test_q = walk_quarters[i]
        train_qs = walk_quarters[:i]
        test = hdf[hdf["quarter"] == test_q]
        if test.empty:
            continue
        test_start = pd.to_datetime(test["date"]).min()
        embargo_cutoff = test_start - pd.Timedelta(days=int(embargo_days * 1.5))  # calendar-day buffer over trading days
        train = hdf[hdf["quarter"].isin(train_qs) & (pd.to_datetime(hdf["date"]) < embargo_cutoff)]
        train = train.dropna(subset=FEATURES + [LABEL])
        test_clean = test.dropna(subset=FEATURES)
        if len(train) < 30 or test_clean.empty:
            continue

        for m in model_names:
            # eval_test is the row set `preds` actually lines up with --
            # normally test_clean, but decision_weights needs its own
            # DECISION_FACTORS-filtered slice. Kept as a per-model local
            # (never overwrites test_clean) so a later model in this same
            # loop -- tabpfn, in particular, which runs after
            # decision_weights in model_names -- still gets the right rows.
            eval_test = test_clean
            if m in ("linear", "gbm"):
                params, inner_ic, _ranked = inner_tune(m, train, embargo_days)
                tuning_history[m].append({"test_quarter": str(test_q), "params": params, "inner_validation_ic": inner_ic})
                model = fit_model_with_params(m, params, train)
                preds = model.predict(test_clean[FEATURES].to_numpy()) if model is not None else None
            elif m == "decision_weights":
                w_norm = fit_decision_weights(train)
                decision_weight_history.append({
                    "test_quarter": str(test_q),
                    "weights": {f: round(float(x), 4) for f, x in zip(DECISION_FACTORS, w_norm)} if w_norm is not None else None,
                })
                eval_test = test_clean.dropna(subset=DECISION_FACTORS)
                preds = eval_test[DECISION_FACTORS].to_numpy() @ w_norm if (w_norm is not None and not eval_test.empty) else None
            else:
                preds = fit_predict(m, train, test_clean)
            if preds is None:
                continue
            fm = evaluate_fold(eval_test, preds)
            fold_metrics[m].append(fm)
            fold_portfolios[m].extend(fm.portfolio_returns)
            fold_benchmarks[m].extend(fm.benchmark_returns)

    walk_summary = {}
    for m in model_names:
        fms = [f for f in fold_metrics[m] if f.n > 0]
        hit_rates = [f.hit_rate for f in fms if f.hit_rate is not None]
        ics = [f.ic for f in fms if f.ic is not None]
        sharpe, dd = sharpe_and_drawdown(fold_portfolios[m])
        bench_sharpe, bench_dd = sharpe_and_drawdown(fold_benchmarks[m])
        excess_returns = [p - b for p, b in zip(fold_portfolios[m], fold_benchmarks[m])]
        mean_excess = float(np.mean(excess_returns)) if excess_returns else None
        walk_summary[m] = {
            "folds_evaluated": len(fms),
            "mean_hit_rate": float(np.mean(hit_rates)) if hit_rates else None,
            "mean_ic": float(np.mean(ics)) if ics else None,
            "sharpe": sharpe,
            "max_drawdown": dd,
            "benchmark_sharpe": bench_sharpe,
            "mean_excess_return_vs_benchmark": mean_excess,
        }

    # Significance: does each non-baseline model's per-fold IC actually beat
    # linear's, more often than chance, on the SAME folds (paired)?
    significance = {}
    linear_ics = [f.ic for f in fold_metrics.get("linear", []) if f.ic is not None]
    for m in model_names:
        if m == "linear":
            continue
        m_ics = [f.ic for f in fold_metrics.get(m, []) if f.ic is not None]
        p = bootstrap_pvalue(m_ics, linear_ics) if len(m_ics) == len(linear_ics) else None
        significance[m] = {"bootstrap_p_not_better_than_linear": p, "beats_linear": (p is not None and p < 0.05)}

    # Final holdout -- train ONCE on everything before it, evaluate ONCE.
    # Models are fit here via fit_model_only (not the walk-forward loop's
    # fit_predict) specifically so the fitted linear/gbm model objects
    # survive past this block -- feature importance and partial dependence
    # below read those objects' own internals, not just their predictions.
    holdout = hdf[hdf["quarter"].isin(holdout_quarters)]
    holdout_start = pd.to_datetime(holdout["date"]).min() if not holdout.empty else None
    holdout_summary = {}
    fitted_models: dict = {}
    train_all = pd.DataFrame()
    final_tuned_params: dict = {}
    final_decision_weights: dict | None = None
    if holdout_start is not None:
        embargo_cutoff = holdout_start - pd.Timedelta(days=int(embargo_days * 1.5))
        train_all = hdf[(pd.to_datetime(hdf["date"]) < embargo_cutoff)].dropna(subset=FEATURES + [LABEL])
        test_all = holdout.dropna(subset=FEATURES)
        for m in model_names:
            if len(train_all) < 30 or test_all.empty:
                holdout_summary[m] = None
                continue
            if m in ("linear", "gbm"):
                # Same nested search as every walk-forward fold, one more
                # time, using ALL pre-holdout history -- this is the config
                # that actually produced the fitted model behind feature
                # importance/partial dependence below, not a separate run.
                params, inner_ic, _ranked = inner_tune(m, train_all, embargo_days)
                final_tuned_params[m] = {"params": params, "inner_validation_ic": inner_ic}
                model = fit_model_with_params(m, params, train_all)
                fitted_models[m] = model
                if model is None:
                    holdout_summary[m] = None
                    continue
                eval_test = test_all
                preds = model.predict(test_all[FEATURES].to_numpy())
            elif m == "decision_weights":
                w_norm = fit_decision_weights(train_all)
                final_decision_weights = {f: round(float(x), 4) for f, x in zip(DECISION_FACTORS, w_norm)} if w_norm is not None else None
                eval_test = test_all.dropna(subset=DECISION_FACTORS)
                if w_norm is None or eval_test.empty:
                    holdout_summary[m] = None
                    continue
                preds = eval_test[DECISION_FACTORS].to_numpy() @ w_norm
            else:
                model = fit_model_only(m, train_all)
                fitted_models[m] = model
                if model is None:
                    holdout_summary[m] = None
                    continue
                eval_test = test_all
                preds = model.predict(test_all[FEATURES].to_numpy())
            fm = evaluate_fold(eval_test, preds)
            sharpe, dd = sharpe_and_drawdown(fm.portfolio_returns)
            excess = [p - b for p, b in zip(fm.portfolio_returns, fm.benchmark_returns)]
            holdout_summary[m] = {
                "hit_rate": fm.hit_rate, "ic": fm.ic, "n": fm.n, "sharpe": sharpe, "max_drawdown": dd,
                "mean_excess_return_vs_benchmark": float(np.mean(excess)) if excess else None,
            }

    live_active_holdout = evaluate_live_active_weights(test_all, active_weights) if holdout_start is not None else None

    # Interpretability: what does each model actually respond to, and how
    # do the raw technical inputs relate to each other and to the label in
    # the first place -- see the /decision-lab Model Results tab's
    # "Feature Importance", "Correlations", and "Partial Dependence"
    # sections. Computed from the SAME final-holdout training fit above,
    # not a separate pass -- these describe that one model, not a new one.
    correlations = compute_correlations(hdf)
    feature_importance = compute_feature_importance(fitted_models, train_all) if not train_all.empty else {}
    partial_dependence = compute_partial_dependence(fitted_models.get("gbm"), train_all) if not train_all.empty else {}

    return {
        "horizon": horizon,
        "skipped": False,
        "quarters_total": len(quarters),
        "walk_forward_quarters": len(walk_quarters),
        "holdout_quarters": [str(q) for q in holdout_quarters],
        "models_evaluated": model_names,
        "walk_forward": walk_summary,
        "significance_vs_linear": significance,
        "final_holdout": holdout_summary,
        "correlations": correlations,
        "feature_importance": feature_importance,
        "partial_dependence": partial_dependence,
        "tuning": {
            "per_fold": tuning_history,
            "final": final_tuned_params,
        },
        "decision_weights": {
            "factors": DECISION_FACTORS,
            "per_fold": decision_weight_history,
            "final": final_decision_weights,
            "note": (
                "Fitted (non-negative, sum-to-1) weights for the 4 Decision Lab factors with "
                "point-in-time history today -- see DECISION_FACTORS. The other 6 live factors "
                "(quality, growth, financial_strength, future_potential, catalyst, market_regime) "
                "aren't included yet -- they need fundamentals/news history that's only just "
                "started accumulating. These fitted weights are NOT yet applied to the live "
                "Decision Lab engine -- see the Methodology tab for the promotion gate this is "
                "waiting on before that would be safe. Also: this model's walk_forward/"
                "final_holdout hit_rate isn't meaningful -- its prediction is always >= 0 "
                "(0-100 factor scores, non-negative weights), so it structurally always "
                "'predicts positive'; IC, sharpe, and mean_excess_return_vs_benchmark are the "
                "metrics that actually reflect this model's ranking skill."
            ),
        },
        "live_active_holdout": live_active_holdout,
    }


def to_markdown(report: dict) -> str:
    lines = [
        "# v7 backtest report", "",
        "_Feature importance, correlations, partial dependence, and the per-fold hyperparameter tuning history are also computed per horizon but only shown on the live /decision-lab Model Results tab -- see data/backtest_report.json for the raw numbers._",
        "",
    ]
    if not TABPFN_AVAILABLE:
        lines.append(f"_TabPFN was not available and was skipped in this run ({TABPFN_IMPORT_ERROR})._")
        lines.append("")
    for h in report["horizons"]:
        lines.append(f"## Horizon: {h['horizon']}")
        if h.get("skipped"):
            lines.append(f"Skipped -- {h['reason']}")
            lines.append("")
            continue
        lines.append("")
        lines.append("| Model | Folds | Hit rate | IC | Sharpe | Max drawdown | Excess vs. benchmark | Beats linear? |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for m in h["models_evaluated"]:
            w = h["walk_forward"][m]
            sig = h["significance_vs_linear"].get(m, {})
            beats = "--" if m == "linear" else ("yes" if sig.get("beats_linear") else "no")
            lines.append(
                f"| {m} | {w['folds_evaluated']} | "
                f"{'' if w['mean_hit_rate'] is None else round(w['mean_hit_rate'], 3)} | "
                f"{'' if w['mean_ic'] is None else round(w['mean_ic'], 3)} | "
                f"{'' if w['sharpe'] is None else round(w['sharpe'], 2)} | "
                f"{'' if w['max_drawdown'] is None else round(w['max_drawdown'], 3)} | "
                f"{'' if w['mean_excess_return_vs_benchmark'] is None else round(w['mean_excess_return_vs_benchmark'], 4)} | {beats} |"
            )
        lines.append("")
        lines.append("**Final holdout (untouched during the above, evaluated once):**")
        lines.append("")
        lines.append("| Model | Hit rate | IC | Sharpe | Max drawdown |")
        lines.append("|---|---|---|---|---|")
        for m in h["models_evaluated"]:
            fh = h["final_holdout"].get(m)
            if fh is None:
                lines.append(f"| {m} | -- | -- | -- | -- |")
                continue
            lines.append(
                f"| {m} | {'' if fh['hit_rate'] is None else round(fh['hit_rate'], 3)} | "
                f"{'' if fh['ic'] is None else round(fh['ic'], 3)} | "
                f"{'' if fh['sharpe'] is None else round(fh['sharpe'], 2)} | "
                f"{'' if fh['max_drawdown'] is None else round(fh['max_drawdown'], 3)} |"
            )
        lines.append("")
        dw = h.get("decision_weights", {})
        lines.append("**Decision Lab fitted weights (final, from all pre-holdout history):**")
        lines.append("")
        if dw.get("final"):
            for f, v in dw["final"].items():
                lines.append(f"- {f}: {v}")
        else:
            lines.append("_Not enough clean training data to fit this horizon yet._")
        lines.append("")
        lines.append(
            "_Note: decision_weights' hit rate above isn't a meaningful number -- its score "
            "is always >= 0 (Decision-Lab-style 0-100 factor scores with non-negative weights), "
            "so it structurally always \"predicts positive\" and hit rate just reflects how often "
            "returns were positive, not real skill. IC, Sharpe, and excess-return ARE meaningful "
            "(they compare ranking/relative sizing, not sign)._"
        )
        lines.append("")
        lines.append("_Not yet applied to the live engine -- see decision_weights.note in the JSON report._")
        lines.append("")
        live = h.get("live_active_holdout")
        if live is not None:
            lines.append(f"**Live (currently active) weights on this run's holdout:** IC = {round(live['ic'], 3) if live['ic'] is not None else '--'}, n = {live['n']}")
        else:
            lines.append("_Live-weight monitoring: not evaluated this run (no active-weights file, or no active row in D1 for this horizon yet)._")
        lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="data/backtest_dataset.csv")
    ap.add_argument("--out-json", default="data/backtest_report.json")
    ap.add_argument("--out-md", default="data/backtest_report.md")
    ap.add_argument(
        "--no-tune", action="store_true",
        help="Skip the nested hyperparameter search (use the fixed DEFAULT_PARAMS for linear/gbm instead) -- "
             "much faster, useful for a quick iteration run. Tuning is ON by default.",
    )
    ap.add_argument(
        "--active-weights", default="data/.active_decision_weights.json",
        help="JSON file mapping horizon -> {factor_column: weight} for Decision Lab's CURRENTLY ACTIVE "
             "weights (written by scripts/backtest/fetch-active-weights.ts before this runs) -- used to "
             "compute each horizon's live_active_holdout (rollback-monitoring input, see "
             "evaluate_live_active_weights). Missing file or missing horizon key just means 'not monitored "
             "this run', not an error -- scripts/backtest.sh always runs fetch-active-weights.ts first, but "
             "a direct manual harness.py invocation without it is still fine.",
    )
    args = ap.parse_args()

    global TUNING_ENABLED
    TUNING_ENABLED = not args.no_tune

    path = Path(args.dataset)
    if not path.exists():
        print(f"Dataset not found at {path} -- run the TS dataset builder first (see scripts/backtest.sh).", file=sys.stderr)
        sys.exit(1)

    df = pd.read_csv(path)
    if not TABPFN_AVAILABLE:
        print(f"Note: TabPFN unavailable ({TABPFN_IMPORT_ERROR}) -- continuing with linear + GBM only.", file=sys.stderr)
    if not TUNING_ENABLED:
        print("Note: --no-tune set -- using fixed default hyperparameters, skipping the nested search.", file=sys.stderr)

    active_weights_by_horizon: dict = {}
    active_weights_path = Path(args.active_weights)
    if active_weights_path.exists():
        try:
            active_weights_by_horizon = json.loads(active_weights_path.read_text())
        except Exception as exc:
            print(f"Note: couldn't parse {active_weights_path} ({exc}) -- skipping live-weight monitoring this run.", file=sys.stderr)
    else:
        print(f"Note: {active_weights_path} not found -- skipping live-weight monitoring this run.", file=sys.stderr)

    report = {"horizons": [run_horizon(df, h, active_weights_by_horizon.get(h)) for h in HORIZON_DAYS]}

    Path(args.out_json).write_text(json.dumps(report, indent=2))
    Path(args.out_md).write_text(to_markdown(report))
    print(f"Wrote {args.out_json} and {args.out_md}")
    print()
    print(to_markdown(report))


if __name__ == "__main__":
    main()
