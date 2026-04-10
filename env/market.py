"""
Market data generator for the Stock Trading environment.

Generates realistic synthetic OHLCV price series using geometric Brownian motion
with configurable drift and volatility. All data is deterministic given a seed,
so graders are fully reproducible.
"""
from __future__ import annotations
import math
import random
from dataclasses import dataclass, field
from typing import List, Tuple


@dataclass
class MarketScenario:
    name: str
    seed: int
    days: int
    start_price: float
    drift: float        # daily drift (mu)  e.g. 0.001 = slight uptrend
    volatility: float   # daily vol  (sigma) e.g. 0.02 = 2% daily vol
    description: str
    prices: List[float] = field(default_factory=list)
    volumes: List[float] = field(default_factory=list)

    def generate(self) -> None:
        rng = random.Random(self.seed)
        price = self.start_price
        self.prices = [price]
        self.volumes = [rng.uniform(800_000, 1_200_000)]
        for _ in range(self.days - 1):
            z = rng.gauss(0, 1)
            ret = self.drift + self.volatility * z
            price = max(price * math.exp(ret), 0.01)
            self.prices.append(round(price, 2))
            vol_mult = rng.uniform(0.7, 1.5)
            self.volumes.append(round(self.volumes[-1] * vol_mult, 0))


def _sma(prices: List[float], window: int) -> float:
    slc = prices[-window:]
    return round(sum(slc) / len(slc), 4) if slc else 0.0


def _rsi(prices: List[float], window: int = 14) -> float:
    if len(prices) < window + 1:
        return 50.0
    deltas = [prices[i] - prices[i-1] for i in range(1, len(prices))]
    gains = [d for d in deltas[-window:] if d > 0]
    losses = [-d for d in deltas[-window:] if d < 0]
    avg_gain = sum(gains) / window if gains else 0.0
    avg_loss = sum(losses) / window if losses else 1e-9
    rs = avg_gain / avg_loss
    return round(100 - 100 / (1 + rs), 2)


def _macd(prices: List[float]) -> float:
    if len(prices) < 26:
        return 0.0
    ema12 = _ema(prices, 12)
    ema26 = _ema(prices, 26)
    return round(ema12 - ema26, 4)


def _ema(prices: List[float], window: int) -> float:
    if not prices:
        return 0.0
    k = 2.0 / (window + 1)
    ema = prices[0]
    for p in prices[1:]:
        ema = p * k + ema * (1 - k)
    return round(ema, 4)


def _bollinger(prices: List[float], window: int = 20) -> Tuple[float, float]:
    if len(prices) < window:
        window = len(prices)
    slc = prices[-window:]
    mean = sum(slc) / len(slc)
    std = math.sqrt(sum((p - mean)**2 for p in slc) / len(slc))
    return round(mean + 2*std, 4), round(mean - 2*std, 4)


def compute_indicators(prices: List[float]) -> dict:
    bb_upper, bb_lower = _bollinger(prices)
    return {
        "SMA5":     _sma(prices, 5),
        "SMA20":    _sma(prices, 20),
        "RSI":      _rsi(prices),
        "MACD":     _macd(prices),
        "BB_upper": bb_upper,
        "BB_lower": bb_lower,
        "EMA12":    _ema(prices, 12),
    }


# ── Pre-built scenarios ───────────────────────────────────────────────────────

def make_scenarios() -> dict:
    scenarios = {
        "trending_up": MarketScenario(
            name="trending_up",
            seed=42,
            days=30,
            start_price=100.0,
            drift=0.003,        # strong uptrend
            volatility=0.015,
            description="A stock in a clear uptrend — buy early and hold.",
        ),
        "mean_reverting": MarketScenario(
            name="mean_reverting",
            seed=137,
            days=40,
            start_price=150.0,
            drift=0.0,          # no trend — oscillates
            volatility=0.025,
            description="A volatile stock with no clear direction — time entries/exits.",
        ),
        "volatile_recovery": MarketScenario(
            name="volatile_recovery",
            seed=999,
            days=50,
            start_price=200.0,
            drift=-0.001,       # slight downtrend early, recovery later
            volatility=0.035,
            description="High-volatility stock with a sharp dip then recovery.",
        ),
    }
    for s in scenarios.values():
        s.generate()
    return scenarios


SCENARIOS = make_scenarios()
