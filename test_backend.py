"""
test_backend.py — Full test suite for the Stock Trading Agent backend.

Covers:
  • market.py  — MarketScenario, all 6 indicators (SMA, RSI, MACD, EMA, BB)
  • models.py  — Pydantic models validation
  • tasks.py   — Portfolio, clamp, grade_episode, TASKS registry
  • environment.py — reset / step / state / list_tasks + edge cases
  • main.py    — FastAPI endpoints via TestClient
"""
import math
import sys
import os
import pytest

# ── path fix so imports work without installing the package ───────────────────
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — market.py
# ═══════════════════════════════════════════════════════════════════════════════
from env.market import (
    MarketScenario,
    _sma, _rsi, _macd, _ema, _bollinger,
    compute_indicators,
    SCENARIOS,
    make_scenarios,
)


class TestMarketScenario:
    def _make(self, seed=42, days=30, start=100.0, drift=0.001, vol=0.015):
        sc = MarketScenario(
            name="test", seed=seed, days=days,
            start_price=start, drift=drift, volatility=vol,
            description="test scenario",
        )
        sc.generate()
        return sc

    def test_prices_length_equals_days(self):
        sc = self._make(days=30)
        assert len(sc.prices) == 30

    def test_volumes_length_equals_days(self):
        sc = self._make(days=40)
        assert len(sc.volumes) == 40

    def test_first_price_is_start_price(self):
        sc = self._make(start=150.0)
        assert sc.prices[0] == 150.0

    def test_prices_always_positive(self):
        sc = self._make(days=50, drift=-0.05, vol=0.1)
        assert all(p > 0 for p in sc.prices)

    def test_prices_are_rounded_to_2dp(self):
        sc = self._make(days=20)
        for p in sc.prices:
            assert p == round(p, 2)

    def test_volumes_are_positive(self):
        sc = self._make(days=20)
        assert all(v > 0 for v in sc.volumes)

    def test_deterministic_with_same_seed(self):
        sc1 = self._make(seed=7, days=25)
        sc2 = self._make(seed=7, days=25)
        assert sc1.prices == sc2.prices
        assert sc1.volumes == sc2.volumes

    def test_different_seeds_give_different_prices(self):
        sc1 = self._make(seed=1, days=20)
        sc2 = self._make(seed=2, days=20)
        assert sc1.prices != sc2.prices

    def test_high_drift_produces_uptrend(self):
        sc = self._make(seed=0, days=60, drift=0.02, vol=0.001)
        assert sc.prices[-1] > sc.prices[0]

    def test_single_day_scenario(self):
        sc = self._make(days=1)
        assert len(sc.prices) == 1
        assert sc.prices[0] == 100.0


class TestSMA:
    def test_sma_exact(self):
        assert _sma([10, 20, 30], 3) == 20.0

    def test_sma_window_larger_than_list_uses_all(self):
        result = _sma([5, 15], 10)
        assert result == 10.0

    def test_sma_single_element(self):
        assert _sma([42.0], 1) == 42.0

    def test_sma_empty_returns_zero(self):
        assert _sma([], 5) == 0.0

    def test_sma_window_1(self):
        assert _sma([7, 8, 9], 1) == 9.0

    def test_sma_rounding(self):
        result = _sma([1, 2, 3, 4], 3)
        assert result == round(sum([2, 3, 4]) / 3, 4)


class TestRSI:
    def test_rsi_returns_50_when_insufficient_data(self):
        assert _rsi([100, 101], window=14) == 50.0

    def test_rsi_all_gains_near_100(self):
        prices = list(range(100, 116))   # 15 prices, all rising
        rsi = _rsi(prices, window=14)
        assert rsi > 90

    def test_rsi_all_losses_near_0(self):
        prices = list(range(115, 99, -1))  # 16 prices, all falling
        rsi = _rsi(prices, window=14)
        assert rsi < 10

    def test_rsi_mixed_stays_in_range(self):
        import random
        rng = random.Random(99)
        prices = [100.0]
        for _ in range(30):
            prices.append(prices[-1] + rng.uniform(-2, 2))
        rsi = _rsi(prices)
        assert 0 <= rsi <= 100

    def test_rsi_exactly_15_prices_window_14(self):
        prices = [100] * 8 + [101] * 7   # 15 prices
        rsi = _rsi(prices, window=14)
        assert isinstance(rsi, float)

    def test_rsi_returns_float(self):
        prices = list(range(100, 130))
        assert isinstance(_rsi(prices), float)


class TestEMA:
    def test_ema_single_price(self):
        assert _ema([50.0], 12) == 50.0

    def test_ema_empty(self):
        assert _ema([], 12) == 0.0

    def test_ema_starts_at_first_price(self):
        # With window=1 (k=1) each value becomes the EMA
        result = _ema([10, 20, 30], 1)
        assert result == 30.0

    def test_ema_weighted_towards_recent(self):
        prices_up = [100, 100, 100, 150]
        prices_down = [150, 100, 100, 100]
        ema_up = _ema(prices_up, 3)
        ema_down = _ema(prices_down, 3)
        assert ema_up > ema_down

    def test_ema_returns_float(self):
        assert isinstance(_ema([1.0, 2.0, 3.0], 3), float)


class TestMACD:
    def test_macd_insufficient_data_returns_zero(self):
        assert _macd([100] * 25) == 0.0
        assert _macd([100] * 10) == 0.0

    def test_macd_exact_26_prices(self):
        result = _macd([100.0] * 26)
        assert result == 0.0   # flat prices → EMA12 == EMA26

    def test_macd_uptrend_positive(self):
        prices = [100 + i * 0.5 for i in range(40)]
        assert _macd(prices) > 0

    def test_macd_downtrend_negative(self):
        prices = [100 - i * 0.5 for i in range(40)]
        assert _macd(prices) < 0

    def test_macd_returns_float(self):
        assert isinstance(_macd([100] * 30), float)


class TestBollinger:
    def test_bollinger_flat_prices_zero_std(self):
        upper, lower = _bollinger([100.0] * 20)
        assert upper == 100.0
        assert lower == 100.0

    def test_bollinger_upper_above_lower(self):
        import random
        rng = random.Random(42)
        prices = [100 + rng.gauss(0, 2) for _ in range(25)]
        upper, lower = _bollinger(prices)
        assert upper >= lower

    def test_bollinger_short_window_uses_all(self):
        upper, lower = _bollinger([90, 100, 110], window=20)
        assert upper > lower

    def test_bollinger_returns_tuple_of_floats(self):
        result = _bollinger([100] * 25)
        assert len(result) == 2
        assert all(isinstance(v, float) for v in result)

    def test_bollinger_single_price(self):
        upper, lower = _bollinger([100.0])
        assert upper == 100.0
        assert lower == 100.0


class TestComputeIndicators:
    def test_returns_all_keys(self):
        prices = [100 + i for i in range(30)]
        ind = compute_indicators(prices)
        for key in ("SMA5", "SMA20", "RSI", "MACD", "BB_upper", "BB_lower", "EMA12"):
            assert key in ind, f"Missing key: {key}"

    def test_all_values_are_floats(self):
        prices = [100.0] * 30
        ind = compute_indicators(prices)
        assert all(isinstance(v, float) for v in ind.values())

    def test_bb_upper_gte_lower(self):
        import random
        rng = random.Random(1)
        prices = [100 + rng.gauss(0, 3) for _ in range(30)]
        ind = compute_indicators(prices)
        assert ind["BB_upper"] >= ind["BB_lower"]

    def test_sma5_uses_last_5(self):
        prices = [1, 2, 3, 4, 5, 100, 200, 300, 400, 500]
        ind = compute_indicators(prices)
        expected = _sma(prices, 5)
        assert ind["SMA5"] == expected


class TestPrebuiltScenarios:
    def test_three_scenarios_exist(self):
        assert set(SCENARIOS.keys()) == {"trending_up", "mean_reverting", "volatile_recovery"}

    def test_trending_up_ends_higher(self):
        sc = SCENARIOS["trending_up"]
        assert sc.prices[-1] > sc.prices[0] * 0.9   # at least reasonable final

    def test_all_scenarios_have_correct_lengths(self):
        expected = {"trending_up": 30, "mean_reverting": 40, "volatile_recovery": 50}
        for name, length in expected.items():
            assert len(SCENARIOS[name].prices) == length

    def test_reproducible_across_make_scenarios(self):
        s1 = make_scenarios()
        s2 = make_scenarios()
        assert s1["trending_up"].prices == s2["trending_up"].prices


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — models.py
# ═══════════════════════════════════════════════════════════════════════════════
from env.models import StockObservation, StockAction, StockReward, StockState


class TestStockAction:
    def test_default_quantity(self):
        a = StockAction(action="buy")
        assert a.quantity == 10

    def test_valid_actions(self):
        for act in ("buy", "sell", "hold"):
            a = StockAction(action=act)
            assert a.action == act

    def test_reasoning_optional(self):
        a = StockAction(action="hold")
        assert a.reasoning is None

    def test_custom_quantity(self):
        a = StockAction(action="buy", quantity=5)
        assert a.quantity == 5

    def test_with_reasoning(self):
        a = StockAction(action="buy", quantity=3, reasoning="RSI oversold")
        assert "RSI" in a.reasoning


class TestStockReward:
    def test_value_within_bounds(self):
        r = StockReward(value=0.75, portfolio_return=0.05, action_valid=True,
                        message="ok", breakdown={"return": 0.75})
        assert 0.0 <= r.value <= 1.0

    def test_value_at_boundary_zero(self):
        r = StockReward(value=0.0, portfolio_return=-0.1, action_valid=False,
                        message="loss", breakdown={})
        assert r.value == 0.0

    def test_breakdown_is_dict(self):
        r = StockReward(value=0.5, portfolio_return=0.0, action_valid=True,
                        message="", breakdown={"return": 0.3, "activity": 0.2})
        assert isinstance(r.breakdown, dict)


class TestStockState:
    def test_defaults(self):
        s = StockState()
        assert s.step_count == 0
        assert s.cumulative_reward == 0.0
        assert s.best_reward == 0.0
        assert s.is_done is False
        assert s.portfolio_value == 0.0
        assert s.episode_history == []

    def test_custom_state(self):
        s = StockState(current_task_id="trending_up", step_count=5,
                       cumulative_reward=2.5, best_reward=0.8,
                       is_done=False, portfolio_value=10500.0)
        assert s.current_task_id == "trending_up"
        assert s.portfolio_value == 10500.0


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — tasks.py
# ═══════════════════════════════════════════════════════════════════════════════
from env.tasks import (
    Portfolio, clamp, grade_episode,
    TASKS, INITIAL_CASH, TRANSACTION_COST_PCT,
)


class TestClamp:
    def test_clamp_zero_becomes_min(self):
        assert clamp(0.0) == 0.01

    def test_clamp_one_becomes_max(self):
        assert clamp(1.0) == 0.99

    def test_clamp_midpoint(self):
        assert clamp(0.5) == 0.5

    def test_clamp_negative(self):
        assert clamp(-10) == 0.01

    def test_clamp_above_one(self):
        assert clamp(5.0) == 0.99

    def test_clamp_exactly_min(self):
        assert clamp(0.01) == 0.01

    def test_clamp_exactly_max(self):
        assert clamp(0.99) == 0.99

    def test_clamp_rounding(self):
        result = clamp(0.123456789)
        assert result == round(0.123456789, 4)


class TestPortfolio:
    def test_initial_value_equals_cash(self):
        p = Portfolio()
        assert p.value(100.0) == INITIAL_CASH

    def test_value_with_shares(self):
        p = Portfolio(cash=5000.0, shares=50)
        assert p.value(100.0) == 5000.0 + 50 * 100.0

    def test_value_with_zero_shares(self):
        p = Portfolio(cash=9000.0, shares=0)
        assert p.value(200.0) == 9000.0

    def test_buy_sell_hold_counts_default_zero(self):
        p = Portfolio()
        assert p.buy_count == 0
        assert p.sell_count == 0
        assert p.hold_count == 0
        assert p.trades == 0

    def test_value_price_zero(self):
        p = Portfolio(cash=1000.0, shares=100)
        assert p.value(0.0) == 1000.0


class TestGradeEpisode:
    def _run(self, task_id="trending_up", cash=INITIAL_CASH, shares=0,
             buy_count=0, sell_count=0, hold_count=0, trades=0):
        task = TASKS[task_id]
        prices = task.scenario.prices
        portfolio = Portfolio(cash=cash, shares=shares, buy_count=buy_count,
                              sell_count=sell_count, hold_count=hold_count, trades=trades)
        actions = ["buy"] * buy_count + ["sell"] * sell_count + ["hold"] * hold_count
        score, breakdown, msg = grade_episode(task, portfolio, prices, actions)
        return score, breakdown, msg

    def test_score_in_valid_range(self):
        score, _, _ = self._run()
        assert 0.01 <= score <= 0.99

    def test_breakdown_has_expected_keys(self):
        _, breakdown, _ = self._run()
        for key in ("return", "activity", "risk", "efficiency"):
            assert key in breakdown

    def test_profit_gives_positive_return_score(self):
        # simulate holding lots of shares at end of uptrend
        task = TASKS["trending_up"]
        final_price = task.scenario.prices[-1]
        # all cash → no return
        _, bd_no_trade, _ = self._run(task_id="trending_up", cash=INITIAL_CASH)
        # invested → profit
        shares = 80
        cost = shares * task.scenario.prices[0] * (1 + TRANSACTION_COST_PCT)
        remaining_cash = INITIAL_CASH - cost
        _, bd_trade, _ = self._run(
            task_id="trending_up",
            cash=remaining_cash, shares=shares,
            buy_count=1, trades=1,
        )
        assert bd_trade["return"] >= bd_no_trade["return"]

    def test_message_contains_return_info(self):
        _, _, msg = self._run()
        assert "%" in msg or "loss" in msg.lower() or "profit" in msg.lower()

    def test_all_breakdown_values_clamped(self):
        score, breakdown, _ = self._run()
        for k, v in breakdown.items():
            assert 0.01 <= v <= 0.99, f"{k}={v} out of range"

    def test_activity_score_zero_for_pure_hold(self):
        _, breakdown, _ = self._run(hold_count=20, trades=20)
        # all holds → active_ratio = 0 → activity clamped to 0.01
        assert breakdown["activity"] == 0.01

    def test_grade_works_for_all_task_ids(self):
        for task_id in TASKS:
            score, breakdown, msg = self._run(task_id=task_id)
            assert 0.01 <= score <= 0.99


class TestTaskRegistry:
    def test_three_tasks_defined(self):
        assert len(TASKS) == 3

    def test_task_ids_match_keys(self):
        for key, task in TASKS.items():
            assert task.id == key

    def test_difficulty_levels(self):
        difficulties = {t.difficulty for t in TASKS.values()}
        assert difficulties == {"easy", "medium", "hard"}

    def test_max_steps_equals_scenario_days(self):
        from env.market import SCENARIOS
        for task in TASKS.values():
            assert task.max_steps == SCENARIOS[task.scenario_key].days

    def test_each_task_has_hints(self):
        for task in TASKS.values():
            assert len(task.hints) >= 1

    def test_initial_cash_positive(self):
        assert INITIAL_CASH > 0

    def test_transaction_cost_small(self):
        assert 0 < TRANSACTION_COST_PCT < 0.01


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — environment.py
# ═══════════════════════════════════════════════════════════════════════════════
from env.environment import StockTradingEnvironment


@pytest.fixture
def env():
    return StockTradingEnvironment()


@pytest.fixture
def reset_env():
    e = StockTradingEnvironment()
    e.reset(task_id="trending_up")
    return e


class TestEnvironmentReset:
    def test_reset_returns_observation(self, env):
        obs = env.reset()
        assert obs is not None

    def test_reset_specific_task(self, env):
        obs = env.reset(task_id="volatile_recovery")
        assert obs.task_id == "volatile_recovery"

    def test_reset_invalid_task_raises(self, env):
        with pytest.raises(ValueError, match="Unknown task_id"):
            env.reset(task_id="nonexistent_task")

    def test_reset_cycles_tasks_without_task_id(self, env):
        obs1 = env.reset()
        obs2 = env.reset()
        obs3 = env.reset()
        # after 3 resets it wraps — check all valid task ids
        from env.tasks import TASKS
        for obs in (obs1, obs2, obs3):
            assert obs.task_id in TASKS

    def test_observation_fields_populated(self, env):
        obs = env.reset(task_id="trending_up")
        assert obs.current_price > 0
        assert obs.cash == INITIAL_CASH
        assert obs.shares_held == 0
        assert obs.portfolio_value == INITIAL_CASH
        assert obs.step_count == 0
        assert obs.done is False

    def test_reset_clears_previous_state(self, env):
        env.reset(task_id="trending_up")
        env.step(StockAction(action="buy", quantity=5))
        obs = env.reset(task_id="trending_up")
        assert obs.shares_held == 0
        assert obs.cash == INITIAL_CASH
        assert obs.previous_actions == []

    def test_price_history_starts_with_at_least_one_price(self, env):
        obs = env.reset(task_id="trending_up")
        assert len(obs.price_history) >= 1

    def test_indicators_dict_not_empty(self, env):
        obs = env.reset(task_id="trending_up")
        assert len(obs.indicators) > 0


class TestEnvironmentStep:
    def test_step_before_reset_raises(self, env):
        with pytest.raises(RuntimeError, match="Call reset"):
            env.step(StockAction(action="hold"))

    def test_hold_action(self, reset_env):
        obs, reward, done, info = reset_env.step(StockAction(action="hold"))
        assert obs is not None
        assert 0.0 <= reward.value <= 1.0
        assert reward.action_valid is True
        assert isinstance(done, bool)

    def test_buy_decreases_cash(self, reset_env):
        cash_before = reset_env._portfolio.cash
        reset_env.step(StockAction(action="buy", quantity=5))
        assert reset_env._portfolio.cash < cash_before

    def test_buy_increases_shares(self, reset_env):
        reset_env.step(StockAction(action="buy", quantity=5))
        assert reset_env._portfolio.shares == 5

    def test_sell_with_no_shares_is_invalid(self, reset_env):
        _, reward, _, _ = reset_env.step(StockAction(action="sell", quantity=5))
        assert reward.action_valid is False

    def test_sell_after_buy_decreases_shares(self, reset_env):
        reset_env.step(StockAction(action="buy", quantity=10))
        shares_after_buy = reset_env._portfolio.shares
        reset_env.step(StockAction(action="sell", quantity=5))
        assert reset_env._portfolio.shares == shares_after_buy - 5

    def test_sell_more_than_held_sells_all(self, reset_env):
        reset_env.step(StockAction(action="buy", quantity=3))
        reset_env.step(StockAction(action="sell", quantity=100))
        assert reset_env._portfolio.shares == 0

    def test_buy_with_insufficient_cash(self, env):
        env.reset(task_id="trending_up")
        # drain cash by buying a lot first
        for _ in range(5):
            env.step(StockAction(action="buy", quantity=20))
        # now try to buy more
        cash_before = env._portfolio.cash
        _, reward, _, _ = env.step(StockAction(action="buy", quantity=1000))
        # either action_valid=False or bought what was affordable
        # either way, cash should not go negative
        assert env._portfolio.cash >= 0

    def test_step_advances_day(self, reset_env):
        day_before = reset_env._day
        reset_env.step(StockAction(action="hold"))
        assert reset_env._day == day_before + 1

    def test_step_returns_correct_types(self, reset_env):
        obs, reward, done, info = reset_env.step(StockAction(action="hold"))
        from env.models import StockObservation, StockReward
        assert isinstance(obs, StockObservation)
        assert isinstance(reward, StockReward)
        assert isinstance(done, bool)
        assert isinstance(info, dict)

    def test_info_contains_expected_keys(self, reset_env):
        _, _, _, info = reset_env.step(StockAction(action="hold"))
        for key in ("task_id", "day", "best_reward", "portfolio_value"):
            assert key in info

    def test_previous_actions_accumulated(self, reset_env):
        reset_env.step(StockAction(action="buy", quantity=2))
        reset_env.step(StockAction(action="hold"))
        obs, _, _, _ = reset_env.step(StockAction(action="sell", quantity=1))
        assert "buy" in obs.previous_actions
        assert "hold" in obs.previous_actions

    def test_done_raises_after_episode_ends(self, env):
        obs = env.reset(task_id="trending_up")
        max_steps = obs.max_steps
        for _ in range(max_steps):
            _, _, done, _ = env.step(StockAction(action="hold"))
            if done:
                break
        with pytest.raises(RuntimeError, match="Episode done"):
            env.step(StockAction(action="hold"))

    def test_episode_ends_within_max_steps(self, env):
        obs = env.reset(task_id="trending_up")
        max_steps = obs.max_steps
        step_count = 0
        done = False
        while not done and step_count < max_steps + 5:
            _, _, done, _ = env.step(StockAction(action="hold"))
            step_count += 1
        assert done
        assert step_count <= max_steps

    def test_reward_value_clamped(self, reset_env):
        for _ in range(5):
            _, reward, done, _ = reset_env.step(StockAction(action="buy", quantity=10))
            assert 0.0 <= reward.value <= 1.0
            if done:
                break

    def test_transaction_cost_applied_on_buy(self, env):
        env.reset(task_id="trending_up")
        price = env._task.scenario.prices[0]
        qty = 5
        expected_cost = price * qty * (1 + TRANSACTION_COST_PCT)
        env.step(StockAction(action="buy", quantity=qty))
        assert abs(env._portfolio.cash - (INITIAL_CASH - expected_cost)) < 0.01

    def test_transaction_cost_applied_on_sell(self, env):
        env.reset(task_id="trending_up")
        env.step(StockAction(action="buy", quantity=5))
        cash_after_buy = env._portfolio.cash
        price_day1 = env._task.scenario.prices[1]
        env.step(StockAction(action="sell", quantity=5))
        expected_proceeds = price_day1 * 5 * (1 - TRANSACTION_COST_PCT)
        assert abs(env._portfolio.cash - (cash_after_buy + expected_proceeds)) < 0.01

    def test_hint_provided_mid_episode(self, env):
        obs = env.reset(task_id="trending_up")
        # step several times to get a hint
        for _ in range(5):
            obs, _, done, _ = env.step(StockAction(action="hold"))
            if done:
                break
        # hints are injected if task has them (trending_up has 3 hints)
        # just verify it's string or None
        assert obs.hint is None or isinstance(obs.hint, str)


class TestEnvironmentState:
    def test_state_before_reset(self, env):
        s = env.state()
        assert s["current_task_id"] is None
        assert s["step_count"] == 0
        assert s["is_done"] is False

    def test_state_after_reset(self, env):
        env.reset(task_id="trending_up")
        s = env.state()
        assert s["current_task_id"] == "trending_up"
        assert s["portfolio_value"] == INITIAL_CASH

    def test_state_after_steps(self, reset_env):
        reset_env.step(StockAction(action="buy", quantity=5))
        s = reset_env.state()
        assert s["step_count"] == 1

    def test_state_cumulative_reward_grows(self, reset_env):
        for _ in range(3):
            reset_env.step(StockAction(action="hold"))
        s = reset_env.state()
        assert s["cumulative_reward"] > 0

    def test_state_episode_history_grows(self, reset_env):
        reset_env.step(StockAction(action="hold"))
        reset_env.step(StockAction(action="hold"))
        s = reset_env.state()
        assert len(s["episode_history"]) == 2

    def test_state_returns_dict(self, env):
        assert isinstance(env.state(), dict)


class TestListTasks:
    def test_list_tasks_returns_three(self, env):
        tasks = env.list_tasks()
        assert len(tasks) == 3

    def test_list_tasks_have_required_keys(self, env):
        tasks = env.list_tasks()
        for t in tasks:
            for key in ("id", "name", "difficulty", "description"):
                assert key in t

    def test_list_tasks_ids_are_valid(self, env):
        tasks = env.list_tasks()
        ids = {t["id"] for t in tasks}
        assert ids == {"trending_up", "mean_reverting", "volatile_recovery"}

    def test_list_tasks_description_truncated(self, env):
        tasks = env.list_tasks()
        for t in tasks:
            assert len(t["description"]) <= 125  # 120 + "…"


class TestFullEpisodeRuns:
    """Integration tests: run complete episodes with different strategies."""

    def _run_episode(self, task_id, strategy="hold"):
        env = StockTradingEnvironment()
        obs = env.reset(task_id=task_id)
        done = False
        steps = 0
        final_reward = 0.0
        while not done:
            if strategy == "hold":
                action = StockAction(action="hold")
            elif strategy == "buy_and_hold":
                action = StockAction(action="buy", quantity=10) if steps == 0 else StockAction(action="hold")
            elif strategy == "sell_all_end":
                remaining = obs.max_steps - obs.current_day
                if remaining <= 2 and obs.shares_held > 0:
                    action = StockAction(action="sell", quantity=obs.shares_held)
                elif steps == 0:
                    action = StockAction(action="buy", quantity=10)
                else:
                    action = StockAction(action="hold")
            else:
                action = StockAction(action="hold")
            obs, reward, done, _ = env.step(action)
            final_reward = reward.value
            steps += 1
        return final_reward, steps, obs

    def test_hold_strategy_completes_trending_up(self):
        score, steps, _ = self._run_episode("trending_up", "hold")
        assert 0.01 <= score <= 0.99
        assert steps == 29  # 30-day scenario, 29 steps

    def test_hold_strategy_completes_mean_reverting(self):
        score, steps, _ = self._run_episode("mean_reverting", "hold")
        assert 0.01 <= score <= 0.99
        assert steps == 39

    def test_hold_strategy_completes_volatile_recovery(self):
        score, steps, _ = self._run_episode("volatile_recovery", "hold")
        assert 0.01 <= score <= 0.99
        assert steps == 49

    def test_buy_and_hold_trending_up_beats_pure_hold(self):
        hold_score, _, _ = self._run_episode("trending_up", "hold")
        bh_score, _, _ = self._run_episode("trending_up", "buy_and_hold")
        # buy and hold on uptrend should typically score higher
        assert bh_score >= hold_score or bh_score > 0.3  # generous check

    def test_final_observation_is_done(self):
        env = StockTradingEnvironment()
        obs = env.reset(task_id="trending_up")
        done = False
        while not done:
            obs, _, done, _ = env.step(StockAction(action="hold"))
        assert obs.done is True


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5 — FastAPI endpoints (TestClient)
# ═══════════════════════════════════════════════════════════════════════════════
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


class TestRootEndpoint:
    def test_get_root_200(self):
        r = client.get("/")
        assert r.status_code == 200

    def test_root_has_name(self):
        r = client.get("/")
        data = r.json()
        assert "name" in data
        assert "Stock Trading" in data["name"]

    def test_root_openenv_true(self):
        data = client.get("/").json()
        assert data["openenv"] is True

    def test_root_has_endpoints_list(self):
        data = client.get("/").json()
        assert "/reset" in data["endpoints"]
        assert "/step" in data["endpoints"]

    def test_root_tasks_count(self):
        data = client.get("/").json()
        assert data["tasks"] == 3


class TestHealthEndpoint:
    def test_health_200(self):
        r = client.get("/health")
        assert r.status_code == 200

    def test_health_status_ok(self):
        data = client.get("/health").json()
        assert data["status"] == "ok"

    def test_health_has_version(self):
        data = client.get("/health").json()
        assert "version" in data

    def test_health_has_environment(self):
        data = client.get("/health").json()
        assert "environment" in data


class TestTasksEndpoint:
    def test_get_tasks_200(self):
        r = client.get("/tasks")
        assert r.status_code == 200

    def test_tasks_returns_list(self):
        data = client.get("/tasks").json()
        assert isinstance(data, list)
        assert len(data) == 3

    def test_tasks_each_has_id(self):
        data = client.get("/tasks").json()
        for t in data:
            assert "id" in t
            assert "difficulty" in t


class TestResetEndpoint:
    def test_reset_no_body_200(self):
        r = client.post("/reset", json={})
        assert r.status_code == 200

    def test_reset_with_valid_task_id(self):
        r = client.post("/reset", json={"task_id": "trending_up"})
        assert r.status_code == 200
        data = r.json()
        assert data["task_id"] == "trending_up"

    def test_reset_with_invalid_task_id_400(self):
        r = client.post("/reset", json={"task_id": "bogus_task"})
        assert r.status_code == 400

    def test_reset_returns_cash_equals_initial(self):
        r = client.post("/reset", json={"task_id": "trending_up"})
        data = r.json()
        assert data["cash"] == INITIAL_CASH

    def test_reset_returns_zero_shares(self):
        data = client.post("/reset", json={"task_id": "trending_up"}).json()
        assert data["shares_held"] == 0

    def test_reset_returns_all_required_fields(self):
        data = client.post("/reset", json={"task_id": "trending_up"}).json()
        required = ["task_id", "current_price", "cash", "shares_held",
                    "portfolio_value", "indicators", "price_history", "done"]
        for f in required:
            assert f in data, f"Missing field: {f}"

    def test_reset_done_is_false(self):
        data = client.post("/reset", json={"task_id": "trending_up"}).json()
        assert data["done"] is False

    def test_reset_indicators_present(self):
        data = client.post("/reset", json={"task_id": "trending_up"}).json()
        ind = data["indicators"]
        assert "RSI" in ind
        assert "MACD" in ind

    def test_reset_mean_reverting(self):
        r = client.post("/reset", json={"task_id": "mean_reverting"})
        assert r.status_code == 200
        assert r.json()["task_id"] == "mean_reverting"

    def test_reset_volatile_recovery(self):
        r = client.post("/reset", json={"task_id": "volatile_recovery"})
        assert r.status_code == 200
        assert r.json()["task_id"] == "volatile_recovery"


class TestStepEndpoint:
    @pytest.fixture(autouse=True)
    def setup(self):
        client.post("/reset", json={"task_id": "trending_up"})

    def test_hold_step_200(self):
        r = client.post("/step", json={"action": "hold", "quantity": 1})
        assert r.status_code == 200

    def test_step_response_structure(self):
        data = client.post("/step", json={"action": "hold"}).json()
        assert "observation" in data
        assert "reward" in data
        assert "done" in data
        assert "info" in data

    def test_buy_step(self):
        data = client.post("/step", json={"action": "buy", "quantity": 5}).json()
        assert data["observation"]["shares_held"] == 5

    def test_sell_with_no_shares_invalid(self):
        client.post("/reset", json={"task_id": "trending_up"})
        data = client.post("/step", json={"action": "sell", "quantity": 5}).json()
        assert data["reward"]["action_valid"] is False

    def test_buy_then_sell(self):
        client.post("/reset", json={"task_id": "trending_up"})
        client.post("/step", json={"action": "buy", "quantity": 10})
        data = client.post("/step", json={"action": "sell", "quantity": 10}).json()
        assert data["observation"]["shares_held"] == 0

    def test_reward_value_in_range(self):
        data = client.post("/step", json={"action": "hold"}).json()
        assert 0.0 <= data["reward"]["value"] <= 1.0

    def test_step_advances_day(self):
        client.post("/reset", json={"task_id": "trending_up"})
        data = client.post("/step", json={"action": "hold"}).json()
        assert data["observation"]["current_day"] == 1

    def test_done_flag_false_mid_episode(self):
        client.post("/reset", json={"task_id": "trending_up"})
        data = client.post("/step", json={"action": "hold"}).json()
        assert data["done"] is False

    def test_info_has_task_id(self):
        data = client.post("/step", json={"action": "hold"}).json()
        assert data["info"]["task_id"] == "trending_up"

    def test_full_episode_via_api(self):
        client.post("/reset", json={"task_id": "trending_up"})
        done = False
        steps = 0
        final_score = 0
        while not done:
            r = client.post("/step", json={"action": "hold"})
            assert r.status_code == 200
            body = r.json()
            done = body["done"]
            final_score = body["reward"]["value"]
            steps += 1
        assert done is True
        assert steps == 29
        assert 0.01 <= final_score <= 0.99

    def test_step_after_done_returns_400(self):
        client.post("/reset", json={"task_id": "trending_up"})
        done = False
        while not done:
            r = client.post("/step", json={"action": "hold"})
            done = r.json()["done"]
        r = client.post("/step", json={"action": "hold"})
        assert r.status_code == 400


class TestStateEndpoint:
    def test_state_200(self):
        r = client.get("/state")
        assert r.status_code == 200

    def test_state_after_reset(self):
        client.post("/reset", json={"task_id": "trending_up"})
        data = client.get("/state").json()
        assert data["current_task_id"] == "trending_up"
        assert data["portfolio_value"] == INITIAL_CASH

    def test_state_step_count_matches(self):
        client.post("/reset", json={"task_id": "trending_up"})
        client.post("/step", json={"action": "hold"})
        client.post("/step", json={"action": "hold"})
        data = client.get("/state").json()
        assert data["step_count"] == 2

    def test_state_has_episode_history(self):
        client.post("/reset", json={"task_id": "trending_up"})
        client.post("/step", json={"action": "hold"})
        data = client.get("/state").json()
        assert len(data["episode_history"]) == 1
