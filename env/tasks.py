"""
Task definitions for the Stock Trading Agent environment.

Task 1 (Easy)   — Trending Up:      Spot and ride a clear uptrend.
Task 2 (Medium) — Mean Reverting:   Time buy-low / sell-high cycles.
Task 3 (Hard)   — Volatile Recovery: Survive a crash and profit from recovery.

Each grader scores strictly in (0.01, 0.99) — never 0.0 or 1.0.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from env.market import SCENARIOS, MarketScenario, compute_indicators


INITIAL_CASH = 10_000.0
SHARES_PER_TRADE = 10
TRANSACTION_COST_PCT = 0.001   # 0.1% per trade


@dataclass
class Task:
    id: str
    name: str
    description: str
    difficulty: str
    scenario_key: str
    hints: List[str] = field(default_factory=list)

    @property
    def scenario(self) -> MarketScenario:
        return SCENARIOS[self.scenario_key]

    @property
    def max_steps(self) -> int:
        return self.scenario.days


@dataclass
class Portfolio:
    cash: float = INITIAL_CASH
    shares: int = 0
    trades: int = 0
    buy_count: int = 0
    sell_count: int = 0
    hold_count: int = 0

    def value(self, price: float) -> float:
        return self.cash + self.shares * price


# ── Grader base ───────────────────────────────────────────────────────────────

def clamp(x: float) -> float:
    """Clamp to strictly open interval (0.01, 0.99)."""
    return round(max(0.01, min(x, 0.99)), 4)


def grade_episode(
    task: Task,
    portfolio: Portfolio,
    price_history: List[float],
    actions_taken: List[str],
) -> Tuple[float, Dict[str, float], str]:
    """
    Common grading logic shared across tasks.
    Returns (score, breakdown, message).

    Weights:
      return     – 50%  (portfolio return vs initial capital)
      activity   – 20%  (penalise pure-hold-forever)
      risk       – 15%  (penalise large drawdowns)
      consistency – 15%  (reward stable positive-return days)

    Individual component scores are computed as raw values in [0, 1],
    then multiplied by their weight. Only the final total is clamped
    to (0.01, 0.99), avoiding the intermediate-clamp distortion.
    """
    prices = task.scenario.prices
    final_price = prices[len(price_history) - 1]
    final_value = portfolio.value(final_price)
    total_return = (final_value - INITIAL_CASH) / INITIAL_CASH

    breakdown: Dict[str, float] = {}

    # ── 1. Return score (weight: 0.50) ────────────────────────────────────────
    # Map return [-20%, +30%] → [0, 1], then scale by weight
    raw_return = max(0.0, min((total_return + 0.20) / 0.50, 1.0))
    breakdown["return"] = round(raw_return * 0.50, 4)

    # ── 2. Activity score (weight: 0.20) ──────────────────────────────────────
    # Penalise pure hold-forever: ratio of active trades to total actions
    n = len(actions_taken)
    active_ratio = (portfolio.buy_count + portfolio.sell_count) / max(n, 1)
    raw_activity = min(active_ratio * 2, 1.0)
    breakdown["activity"] = round(raw_activity * 0.20, 4)

    # ── 3. Risk score (weight: 0.15) ──────────────────────────────────────────
    # Penalise going bankrupt / large drawdowns
    min_val = min(
        portfolio.value(p) for p in prices[:len(price_history)]
    ) if price_history else INITIAL_CASH
    drawdown = (INITIAL_CASH - min_val) / INITIAL_CASH
    raw_risk = max(0.0, 1.0 - drawdown * 3)
    breakdown["risk"] = round(raw_risk * 0.15, 4)

    # ── 4. Consistency score (weight: 0.15) ───────────────────────────────────
    # Reward stable growth: fraction of days with positive portfolio change.
    # This replaces the old "efficiency" metric which wrongly rewarded
    # finishing early — in trading, using all available days is expected.
    if len(price_history) >= 2:
        positive_days = 0
        for i in range(1, len(price_history)):
            day_val = portfolio.value(price_history[i])
            prev_val = portfolio.value(price_history[i - 1])
            if day_val >= prev_val:
                positive_days += 1
        raw_consistency = positive_days / (len(price_history) - 1)
    else:
        raw_consistency = 0.5
    breakdown["consistency"] = round(raw_consistency * 0.15, 4)

    total = sum(breakdown.values())
    total = clamp(total)

    if total_return > 0.10:
        msg = f"Great job! Portfolio returned {total_return:.1%}. Score: {total:.4f}"
    elif total_return > 0:
        msg = f"Slight profit of {total_return:.1%}. Try to act on stronger signals."
    elif total_return > -0.05:
        msg = f"Small loss of {total_return:.1%}. Check the trend indicators."
    else:
        msg = f"Loss of {total_return:.1%}. Review your entry/exit timing."

    return total, breakdown, msg



# ── Task registry ─────────────────────────────────────────────────────────────

TASKS: Dict[str, Task] = {
    "trending_up": Task(
        id="trending_up",
        name="Ride the Uptrend",
        difficulty="easy",
        scenario_key="trending_up",
        description=(
            "A tech stock is in a clear uptrend (+0.3% daily drift). "
            "Your goal: buy early and hold to maximise the 30-day return. "
            "Start with $10,000 cash. Each trade costs 0.1% in fees. "
            "Score is based on final portfolio return."
        ),
        hints=[
            "Hint 1: Check SMA5 vs SMA20 — when SMA5 > SMA20 the trend is bullish.",
            "Hint 2: RSI below 70 means the stock is not yet overbought — safe to buy.",
            "Hint 3: In a strong uptrend, buy early and hold. Avoid selling until the end.",
        ],
    ),
    "mean_reverting": Task(
        id="mean_reverting",
        name="Buy Low, Sell High",
        difficulty="medium",
        scenario_key="mean_reverting",
        description=(
            "A sideways-trading stock oscillates around $150 with high volatility. "
            "Your goal: buy when price drops below the lower Bollinger Band and sell "
            "when it exceeds the upper band. Score is based on total return over 40 days."
        ),
        hints=[
            "Hint 1: Buy when price < BB_lower (oversold). Sell when price > BB_upper (overbought).",
            "Hint 2: RSI < 35 is a strong buy signal; RSI > 65 is a strong sell signal.",
            "Hint 3: Hold if no strong signal — unnecessary trades eat into profits via fees.",
        ],
    ),
    "volatile_recovery": Task(
        id="volatile_recovery",
        name="Crash and Recovery",
        difficulty="hard",
        scenario_key="volatile_recovery",
        description=(
            "A high-volatility stock dips sharply in the first half then recovers. "
            "Your goal: avoid the dip (sell or hold cash), buy at the bottom, "
            "then sell into the recovery. Score is based on 50-day total return."
        ),
        hints=[
            "Hint 1: MACD going negative signals the start of the dip — sell to preserve cash.",
            "Hint 2: RSI < 30 is the buy signal at the bottom of the crash.",
            "Hint 3: Once RSI crosses back above 50 and MACD turns positive, take profits.",
        ],
    ),
}
