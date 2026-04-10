"""
StockTradingEnvironment — core OpenEnv implementation.

reset()  → StockObservation
step()   → (StockObservation, StockReward, done, info)
state()  → dict
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Tuple

from env.market import compute_indicators
from env.models import StockAction, StockObservation, StockReward, StockState
from env.tasks import (
    INITIAL_CASH,
    TASKS,
    TRANSACTION_COST_PCT,
    Portfolio,
    Task,
    clamp,
    grade_episode,
)


class StockTradingEnvironment:
    MAX_STEPS_DEFAULT = 50

    def __init__(self) -> None:
        self._task: Optional[Task] = None
        self._portfolio: Optional[Portfolio] = None
        self._day: int = 0
        self._done: bool = False
        self._actions_taken: List[str] = []
        self._feedback_history: List[str] = []
        self._episode_history: List[Dict[str, Any]] = []
        self._cumulative_reward: float = 0.0
        self._best_reward: float = 0.0
        self._task_ids = list(TASKS.keys())
        self._next_task_idx = 0

    # ── Public API ────────────────────────────────────────────────────────────

    def reset(self, task_id: Optional[str] = None) -> StockObservation:
        if task_id and task_id not in TASKS:
            raise ValueError(f"Unknown task_id '{task_id}'. Available: {list(TASKS)}")

        if task_id:
            self._task = TASKS[task_id]
        else:
            self._task = TASKS[self._task_ids[self._next_task_idx % len(self._task_ids)]]
            self._next_task_idx += 1

        self._portfolio = Portfolio(cash=INITIAL_CASH)
        self._day = 0
        self._done = False
        self._actions_taken = []
        self._feedback_history = []
        self._episode_history = []
        self._cumulative_reward = 0.0
        self._best_reward = 0.0

        return self._make_observation(hint=None)

    def step(self, action: StockAction) -> Tuple[StockObservation, StockReward, bool, Dict]:
        if self._task is None or self._portfolio is None:
            raise RuntimeError("Call reset() before step().")
        if self._done:
            raise RuntimeError("Episode done. Call reset().")

        prices = self._task.scenario.prices
        current_price = prices[self._day]
        action_str = action.action.lower().strip()
        valid = True
        step_msg = ""

        # ── Execute trade ─────────────────────────────────────────────────────
        qty = max(1, action.quantity)

        if action_str == "buy":
            cost = current_price * qty * (1 + TRANSACTION_COST_PCT)
            if cost <= self._portfolio.cash:
                self._portfolio.cash -= cost
                self._portfolio.shares += qty
                self._portfolio.buy_count += 1
                step_msg = f"Bought {qty} shares @ ${current_price:.2f} (cost ${cost:.2f})"
            else:
                # Buy as many as affordable
                affordable = int(self._portfolio.cash / (current_price * (1 + TRANSACTION_COST_PCT)))
                if affordable > 0:
                    cost = current_price * affordable * (1 + TRANSACTION_COST_PCT)
                    self._portfolio.cash -= cost
                    self._portfolio.shares += affordable
                    self._portfolio.buy_count += 1
                    step_msg = f"Bought {affordable} shares (max affordable) @ ${current_price:.2f}"
                else:
                    valid = False
                    step_msg = "Not enough cash to buy even 1 share."
                    action_str = "hold"

        elif action_str == "sell":
            if self._portfolio.shares >= qty:
                proceeds = current_price * qty * (1 - TRANSACTION_COST_PCT)
                self._portfolio.cash += proceeds
                self._portfolio.shares -= qty
                self._portfolio.sell_count += 1
                step_msg = f"Sold {qty} shares @ ${current_price:.2f} (proceeds ${proceeds:.2f})"
            elif self._portfolio.shares > 0:
                qty = self._portfolio.shares
                proceeds = current_price * qty * (1 - TRANSACTION_COST_PCT)
                self._portfolio.cash += proceeds
                self._portfolio.shares = 0
                self._portfolio.sell_count += 1
                step_msg = f"Sold all {qty} shares @ ${current_price:.2f}"
            else:
                valid = False
                step_msg = "No shares to sell."
                action_str = "hold"

        else:
            action_str = "hold"
            self._portfolio.hold_count += 1
            step_msg = f"Held position. Price: ${current_price:.2f}"

        self._portfolio.trades += 1
        self._actions_taken.append(action_str)

        # ── Advance day ───────────────────────────────────────────────────────
        self._day += 1
        max_days = len(prices) - 1
        if self._day >= max_days:
            self._done = True

        # ── Step reward (partial signal each day) ─────────────────────────────
        next_price = prices[min(self._day, max_days)]
        port_value = self._portfolio.value(next_price)
        daily_return = (port_value - INITIAL_CASH) / INITIAL_CASH

        # Map daily return to a partial reward signal
        step_score = clamp(0.50 + daily_return * 2)   # centred at 0.50

        self._feedback_history.append(step_msg)
        self._cumulative_reward += step_score
        self._best_reward = max(self._best_reward, step_score)

        # ── Final grade at episode end ────────────────────────────────────────
        reward_value = step_score
        breakdown: Dict[str, float] = {"step_return": step_score}
        message = step_msg

        if self._done:
            reward_value, breakdown, message = grade_episode(
                self._task,
                self._portfolio,
                prices[: self._day + 1],
                self._actions_taken,
            )
            self._best_reward = reward_value

        reward = StockReward(
            value=reward_value,
            portfolio_return=daily_return,
            action_valid=valid,
            message=message,
            breakdown=breakdown,
        )

        self._episode_history.append({
            "day": self._day,
            "action": action_str,
            "price": current_price,
            "portfolio_value": port_value,
            "score": reward_value,
            "timestamp": time.time(),
        })

        hint: Optional[str] = None
        if not self._done and self._task.hints:
            idx = min(len(self._actions_taken) // max(1, max_days // 3),
                      len(self._task.hints) - 1)
            hint = self._task.hints[idx]

        obs = self._make_observation(hint=hint)
        info = {
            "task_id": self._task.id,
            "day": self._day,
            "best_reward": self._best_reward,
            "portfolio_value": port_value,
        }
        return obs, reward, self._done, info

    def state(self) -> Dict[str, Any]:
        port_value = 0.0
        if self._task and self._portfolio:
            prices = self._task.scenario.prices
            price = prices[min(self._day, len(prices) - 1)]
            port_value = self._portfolio.value(price)

        return StockState(
            current_task_id=self._task.id if self._task else None,
            step_count=self._day,
            cumulative_reward=round(self._cumulative_reward, 4),
            best_reward=round(self._best_reward, 4),
            is_done=self._done,
            portfolio_value=round(port_value, 2),
            episode_history=self._episode_history,
        ).model_dump()

    def list_tasks(self) -> List[Dict[str, str]]:
        return [
            {
                "id": t.id,
                "name": t.name,
                "difficulty": t.difficulty,
                "description": t.description[:120] + "…",
            }
            for t in TASKS.values()
        ]

    # ── Private ───────────────────────────────────────────────────────────────

    def _make_observation(self, hint: Optional[str]) -> StockObservation:
        assert self._task and self._portfolio
        prices = self._task.scenario.prices
        volumes = self._task.scenario.volumes
        day = self._day
        price = prices[day]
        window = prices[max(0, day - 30): day + 1]
        vol_window = volumes[max(0, day - 30): day + 1]

        port_value = self._portfolio.value(price)
        unrealised = self._portfolio.shares * price - (INITIAL_CASH - self._portfolio.cash)
        total_return_pct = (port_value - INITIAL_CASH) / INITIAL_CASH * 100

        return StockObservation(
            task_id=self._task.id,
            task_name=self._task.name,
            task_description=self._task.description,
            difficulty=self._task.difficulty,
            current_day=day,
            total_days=self._task.max_steps,
            current_price=round(price, 2),
            price_history=[round(p, 2) for p in window],
            volume_history=[round(v, 0) for v in vol_window],
            indicators=compute_indicators(window),
            cash=round(self._portfolio.cash, 2),
            shares_held=self._portfolio.shares,
            portfolio_value=round(port_value, 2),
            initial_portfolio_value=INITIAL_CASH,
            unrealized_pnl=round(unrealised, 2),
            total_return_pct=round(total_return_pct, 4),
            step_count=day,
            max_steps=self._task.max_steps,
            previous_actions=self._actions_taken[-10:],
            previous_feedback=self._feedback_history[-5:],
            hint=hint,
            done=self._done,
        )
