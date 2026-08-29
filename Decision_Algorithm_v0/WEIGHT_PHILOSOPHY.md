# V1 Weight Philosophy

The first version deliberately does **not** claim to know the correct weights.

## Why

The investment problem has multiple dimensions:

- business quality
- growth
- balance-sheet strength
- valuation
- future potential
- market momentum
- current entry
- risk
- catalysts
- market regime

Their importance is likely to vary with the investment horizon.

Therefore V1 uses separate provisional weights for short, medium and long horizons.

## Provisional structure

### Short term
More emphasis on:
- technical conditions
- entry
- catalysts
- momentum

### Medium term
More balanced between:
- growth
- quality
- valuation
- technicals
- entry
- risk

### Long term
More emphasis on:
- quality
- growth
- valuation
- financial strength
- durable future potential

## What the algorithm must NOT assume

A high growth score does not automatically mean BUY.

A low valuation score does not automatically mean SELL.

A strong technical setup does not compensate indefinitely for a broken business.

A cheap stock can remain cheap.

A great company can be a poor investment when purchased at an excessive valuation.

The final decision therefore remains a weighted multi-factor decision.

## V1.1 research direction

The weights should later be investigated using:

1. equal-weight baseline
2. hand-designed hypotheses
3. one-factor and incremental-factor tests
4. weight sensitivity
5. constrained weight search
6. rolling walk-forward validation
7. regime analysis
8. geography/sector analysis
9. out-of-sample testing

The goal should be to find **robust ranges of weights**, not one historically perfect vector.

## Important distinction

The factor scores and the weights are separate.

That means we can later improve the scoring methodology without redesigning the decision engine,
and we can investigate weights without changing the factor definitions.
