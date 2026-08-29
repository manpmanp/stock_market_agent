from stock_algorithm import (
    FACTORS,
    DEFAULT_WEIGHTS,
    StockInput,
    StockDecisionAlgorithm,
    sensitivity_table,
)

# Example stock only. These are illustrative scores, NOT a real company.
scores = {
    "quality": 88,
    "growth": 91,
    "financial_strength": 84,
    "valuation": 61,
    "future_potential": 94,
    "technical": 76,
    "entry": 68,
    "risk": 72,
    "catalyst": 80,
    "market_regime": 70,
}

stock = StockInput(
    ticker="EXAMPLE",
    scores=scores,
    current_price=100,
    fair_value=118,
    expected_price=130,
    downside_price=88,
)

algorithm = StockDecisionAlgorithm()
decision = algorithm.score(stock)

print("Ticker:", decision.ticker)
print("Overall:", decision.overall_view)
print()

for horizon, result in decision.horizons.items():
    print(
        f"{horizon.upper():6} | "
        f"score={result.score:5.1f} | "
        f"{result.decision:12} | "
        f"confidence={result.confidence:5.1f} | "
        f"valuation={result.valuation_status:18} | "
        f"entry={result.entry_status}"
    )

print()
print("Valuation metrics:")
for key, value in decision.valuation.items():
    print(f"  {key}: {value}")

print()
print("Warnings:")
for warning in decision.warnings:
    print(" -", warning)

print()
print("Long-term weight sensitivity:")
table = sensitivity_table(scores, DEFAULT_WEIGHTS["long"], delta=0.05)
for factor, values in table.items():
    print(
        f"  {factor:20} "
        f"base={values['base']:6.2f} "
        f"-5%={values['minus']:6.2f} "
        f"+5%={values['plus']:6.2f}"
    )
