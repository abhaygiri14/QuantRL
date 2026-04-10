"""
Typed Pydantic models for the Stock Trading Agent OpenEnv environment.
Observation, Action, Reward, State — all per the OpenEnv spec.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class StockObservation(BaseModel):
    task_id: str
    task_name: str
    task_description: str
    difficulty: str                          # easy | medium | hard

    # Market snapshot
    current_day: int
    total_days: int
    current_price: float
    price_history: List[float]               # last N closing prices
    volume_history: List[float]              # last N volumes
    indicators: Dict[str, float]            # SMA5, SMA20, RSI, MACD, BB_upper, BB_lower

    # Portfolio
    cash: float
    shares_held: int
    portfolio_value: float
    initial_portfolio_value: float
    unrealized_pnl: float
    total_return_pct: float

    # Episode state
    step_count: int
    max_steps: int
    previous_actions: List[str]
    previous_feedback: List[str]
    hint: Optional[str] = None
    done: bool = False


class StockAction(BaseModel):
    action: str = Field(
        description="Trading action: 'buy', 'sell', or 'hold'"
    )
    quantity: int = Field(
        default=10,
        description="Number of shares to buy or sell (ignored for hold)"
    )
    reasoning: Optional[str] = Field(
        default=None,
        description="Agent's reasoning for this action"
    )


class StockReward(BaseModel):
    value: float = Field(ge=0.0, le=1.0)
    portfolio_return: float
    action_valid: bool
    message: str
    breakdown: Dict[str, float]


class StockState(BaseModel):
    current_task_id: Optional[str] = None
    step_count: int = 0
    cumulative_reward: float = 0.0
    best_reward: float = 0.0
    is_done: bool = False
    portfolio_value: float = 0.0
    episode_history: List[Dict[str, Any]] = []
