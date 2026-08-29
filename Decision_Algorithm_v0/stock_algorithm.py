from dataclasses import dataclass, field
from typing import Dict, List, Optional
import math


# -----------------------------
# Factor model
# -----------------------------

FACTORS = (
    "quality",
    "growth",
    "financial_strength",
    "valuation",
    "future_potential",
    "technical",
    "entry",
    "risk",
    "catalyst",
    "market_regime",
)

HORIZONS = ("short", "medium", "long")


@dataclass
class StockInput:
    """
    Input to the algorithm.

    All factor scores are 0..100:
        0   = very poor
        50  = neutral
        100 = excellent

    The algorithm does not decide how raw financial data is converted into
    these scores yet. That is intentionally separated from the decision layer.
    """
    ticker: str

    scores: Dict[str, float]

    current_price: Optional[float] = None
    fair_value: Optional[float] = None

    # Optional explicit estimates supplied by the caller.
    expected_price: Optional[float] = None
    downside_price: Optional[float] = None

    # Optional benchmark/market context.
    benchmark_return: Optional[float] = None


@dataclass
class HorizonResult:
    horizon: str
    score: float
    decision: str
    confidence: float
    factor_contribution: Dict[str, float]
    strengths: List[str]
    weaknesses: List[str]
    valuation_status: str
    entry_status: str


@dataclass
class StockDecision:
    ticker: str
    horizons: Dict[str, HorizonResult]
    overall_view: str
    valuation: Dict[str, Optional[float]]
    warnings: List[str] = field(default_factory=list)


# -----------------------------
# Default weighting hypotheses
# -----------------------------

# IMPORTANT:
# These are starting hypotheses only.
# They are not claimed to be optimal.
#
# Each horizon sums to 1.00.

DEFAULT_WEIGHTS = {
    "short": {
        "quality": 0.08,
        "growth": 0.07,
        "financial_strength": 0.05,
        "valuation": 0.08,
        "future_potential": 0.08,
        "technical": 0.18,
        "entry": 0.22,
        "risk": 0.10,
        "catalyst": 0.10,
        "market_regime": 0.04,
    },
    "medium": {
        "quality": 0.13,
        "growth": 0.14,
        "financial_strength": 0.09,
        "valuation": 0.14,
        "future_potential": 0.10,
        "technical": 0.10,
        "entry": 0.10,
        "risk": 0.07,
        "catalyst": 0.07,
        "market_regime": 0.06,
    },
    "long": {
        "quality": 0.19,
        "growth": 0.19,
        "financial_strength": 0.14,
        "valuation": 0.17,
        "future_potential": 0.10,
        "technical": 0.03,
        "entry": 0.04,
        "risk": 0.07,
        "catalyst": 0.02,
        "market_regime": 0.05,
    },
}


# -----------------------------
# Decision thresholds
# -----------------------------

DEFAULT_THRESHOLDS = {
    "strong_buy": 85,
    "buy": 75,
    "accumulate": 65,
    "hold": 50,
    "reduce": 40,
    "sell": 25,
}


def _validate_weights(weights: Dict[str, Dict[str, float]]) -> None:
    for horizon in HORIZONS:
        if horizon not in weights:
            raise ValueError(f"Missing horizon: {horizon}")

        missing = set(FACTORS) - set(weights[horizon])
        if missing:
            raise ValueError(
                f"{horizon}: missing weights: {sorted(missing)}"
            )

        if any(v < 0 for v in weights[horizon].values()):
            raise ValueError(f"{horizon}: weights cannot be negative")

        total = sum(weights[horizon].values())
        if not math.isclose(total, 1.0, abs_tol=1e-9):
            raise ValueError(
                f"{horizon}: weights must sum to 1.0; got {total}"
            )


def _validate_scores(scores: Dict[str, float]) -> None:
    missing = set(FACTORS) - set(scores)
    if missing:
        raise ValueError(f"Missing factor scores: {sorted(missing)}")

    for factor in FACTORS:
        value = scores[factor]
        if not 0 <= value <= 100:
            raise ValueError(
                f"{factor}: score must be between 0 and 100; got {value}"
            )


# -----------------------------
# Valuation / entry logic
# -----------------------------

def valuation_metrics(
    current_price: Optional[float],
    fair_value: Optional[float],
    expected_price: Optional[float],
    downside_price: Optional[float],
) -> Dict[str, Optional[float]]:
    result = {
        "fair_value_upside": None,
        "margin_of_safety": None,
        "expected_return": None,
        "downside": None,
        "risk_reward": None,
    }

    if current_price is None or current_price <= 0:
        return result

    if fair_value is not None and fair_value > 0:
        result["fair_value_upside"] = fair_value / current_price - 1
        result["margin_of_safety"] = 1 - current_price / fair_value

    if expected_price is not None:
        result["expected_return"] = expected_price / current_price - 1

    if downside_price is not None:
        result["downside"] = 1 - downside_price / current_price

    if (
        result["expected_return"] is not None
        and result["downside"] is not None
        and result["downside"] > 0
    ):
        result["risk_reward"] = (
            result["expected_return"] / result["downside"]
        )

    return result


def valuation_status(
    current_price: Optional[float],
    fair_value: Optional[float],
) -> str:
    if current_price is None or fair_value is None or fair_value <= 0:
        return "UNKNOWN"

    ratio = current_price / fair_value

    if ratio <= 0.70:
        return "DEEPLY_UNDERVALUED"
    if ratio <= 0.85:
        return "UNDERVALUED"
    if ratio <= 1.05:
        return "FAIRLY_VALUED"
    if ratio <= 1.25:
        return "EXPENSIVE"
    return "VERY_EXPENSIVE"


def entry_status(entry_score: float) -> str:
    if entry_score >= 85:
        return "EXCELLENT_ENTRY"
    if entry_score >= 70:
        return "GOOD_ENTRY"
    if entry_score >= 55:
        return "NEUTRAL_ENTRY"
    if entry_score >= 40:
        return "WEAK_ENTRY"
    return "POOR_ENTRY"


# -----------------------------
# Decision engine
# -----------------------------

class StockDecisionAlgorithm:
    """
    First-version decision engine.

    It deliberately separates:
      1. factor scores,
      2. horizon-specific weighting,
      3. valuation/entry interpretation,
      4. final decision.

    This makes the model inspectable and allows the weights to be changed
    without changing the rest of the algorithm.
    """

    def __init__(
        self,
        weights: Optional[Dict[str, Dict[str, float]]] = None,
        thresholds: Optional[Dict[str, float]] = None,
    ):
        self.weights = weights or DEFAULT_WEIGHTS
        self.thresholds = thresholds or DEFAULT_THRESHOLDS
        _validate_weights(self.weights)

    def score(self, stock: StockInput) -> StockDecision:
        _validate_scores(stock.scores)

        valuation = valuation_metrics(
            stock.current_price,
            stock.fair_value,
            stock.expected_price,
            stock.downside_price,
        )

        results = {}

        for horizon in HORIZONS:
            results[horizon] = self._evaluate_horizon(
                stock, horizon, valuation
            )

        overall = self._overall_view(results)

        warnings = self._warnings(stock, valuation, results)

        return StockDecision(
            ticker=stock.ticker,
            horizons=results,
            overall_view=overall,
            valuation=valuation,
            warnings=warnings,
        )

    def _evaluate_horizon(
        self,
        stock: StockInput,
        horizon: str,
        valuation: Dict[str, Optional[float]],
    ) -> HorizonResult:

        weights = self.weights[horizon]

        contribution = {
            factor: stock.scores[factor] * weight
            for factor, weight in weights.items()
        }

        raw_score = sum(contribution.values())

        # Confidence is deliberately NOT another weighted score.
        # It measures consistency of the factor evidence.
        values = list(stock.scores.values())
        mean = sum(values) / len(values)
        variance = sum((x - mean) ** 2 for x in values) / len(values)
        std = math.sqrt(variance)

        # Lower dispersion = more internally consistent evidence.
        # A high dispersion is uncertainty, not automatically bullish/bearish.
        confidence = max(0.0, min(100.0, 100.0 - std))

        decision = self._decision(raw_score)

        strengths = [
            factor for factor, value in stock.scores.items()
            if value >= 75
        ]
        weaknesses = [
            factor for factor, value in stock.scores.items()
            if value <= 40
        ]

        return HorizonResult(
            horizon=horizon,
            score=round(raw_score, 2),
            decision=decision,
            confidence=round(confidence, 2),
            factor_contribution={
                k: round(v, 3) for k, v in contribution.items()
            },
            strengths=strengths,
            weaknesses=weaknesses,
            valuation_status=valuation_status(
                stock.current_price, stock.fair_value
            ),
            entry_status=entry_status(stock.scores["entry"]),
        )

    def _decision(self, score: float) -> str:
        t = self.thresholds

        if score >= t["strong_buy"]:
            return "STRONG BUY"
        if score >= t["buy"]:
            return "BUY"
        if score >= t["accumulate"]:
            return "ACCUMULATE"
        if score >= t["hold"]:
            return "HOLD / WAIT"
        if score >= t["reduce"]:
            return "REDUCE"
        if score >= t["sell"]:
            return "SELL"
        return "STRONG SELL"

    def _overall_view(self, results: Dict[str, HorizonResult]) -> str:
        scores = [r.score for r in results.values()]
        avg = sum(scores) / len(scores)

        short = results["short"].decision
        medium = results["medium"].decision
        long = results["long"].decision

        if avg >= 80:
            return "BROADLY BULLISH"
        if avg >= 65:
            return "BULLISH"
        if avg >= 50:
            return "MIXED / SELECTIVE"
        if avg >= 35:
            return "BEARISH"
        return "BROADLY BEARISH"

    def _warnings(self, stock, valuation, results):
        warnings = []

        if (
            valuation["fair_value_upside"] is not None
            and valuation["fair_value_upside"] < 0
        ):
            warnings.append("Price is above estimated fair value.")

        if stock.scores["risk"] < 40:
            warnings.append("Risk score is weak.")

        if stock.scores["financial_strength"] < 40:
            warnings.append("Financial-strength score is weak.")

        if stock.scores["valuation"] < 40:
            warnings.append("Valuation score is weak.")

        if stock.scores["entry"] < 40:
            warnings.append("Current entry score is poor.")

        # Detect disagreement between the short and long horizons.
        if results["short"].score - results["long"].score >= 20:
            warnings.append(
                "Short-term setup is materially stronger than the long-term thesis."
            )

        if results["long"].score - results["short"].score >= 20:
            warnings.append(
                "Long-term thesis is materially stronger than the current short-term setup."
            )

        return warnings


# -----------------------------
# Utility functions for research
# -----------------------------

def weighted_score(
    scores: Dict[str, float],
    weights: Dict[str, float],
) -> float:
    """
    Simple transparent score calculation useful for testing alternative
    weight vectors.
    """
    _validate_scores(scores)

    missing = set(FACTORS) - set(weights)
    if missing:
        raise ValueError(f"Missing weights: {sorted(missing)}")

    total_weight = sum(weights.values())
    if total_weight <= 0:
        raise ValueError("Weight sum must be positive.")

    normalized = {
        factor: weights[factor] / total_weight
        for factor in FACTORS
    }

    return sum(scores[f] * normalized[f] for f in FACTORS)


def perturb_weights(
    weights: Dict[str, float],
    factor: str,
    delta: float,
) -> Dict[str, float]:
    """
    Used for sensitivity analysis.

    Example:
        perturb_weights(weights, "valuation", +0.05)

    The requested factor receives delta and the remaining factors are
    proportionally rescaled so the total remains 1.
    """
    if factor not in weights:
        raise ValueError(f"Unknown factor: {factor}")

    w = dict(weights)
    new_value = w[factor] + delta

    if new_value < 0:
        raise ValueError("Perturbation would create a negative weight.")

    old_remaining = 1 - w[factor]
    new_remaining = 1 - new_value

    w[factor] = new_value

    if old_remaining <= 0:
        return w

    for f in w:
        if f != factor:
            w[f] = w[f] / old_remaining * new_remaining

    return w


def sensitivity_table(
    scores: Dict[str, float],
    weights: Dict[str, float],
    delta: float = 0.05,
) -> Dict[str, Dict[str, float]]:
    """
    Shows how much the total score changes when each factor receives a
    small increase/decrease in weight.

    This is intentionally simple in V1. It is not a backtest optimizer.
    """
    base = weighted_score(scores, weights)
    output = {}

    for factor in FACTORS:
        row = {"base": base}

        for label, change in [
            ("minus", -delta),
            ("plus", +delta),
        ]:
            try:
                altered = perturb_weights(weights, factor, change)
                row[label] = weighted_score(scores, altered)
            except ValueError:
                row[label] = None

        output[factor] = row

    return output
