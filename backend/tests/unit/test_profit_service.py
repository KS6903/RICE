"""The Profit calculator's formulas, and what staff are shown of them. The worked
example is also in the web app's mappers/ProfitMapper.spec.ts: the two must agree."""

from types import SimpleNamespace

import pytest

from app.services.profit_service import is_boss, price_plan, staff_view

LOT = {
    "palay_kg": 1000.0,
    "palay_price": 20.0,
    "moisture_pct": 14.0,
    "recovery_pct": 65.0,
    "other_costs": 1000.0,
    "byproducts": [(22.5, 1.0), (9.5, 8.0)],
    "target_margin_pct": 10.0,
    "market_price": None,
}


def test_the_worked_example():
    plan = price_plan(**LOT)
    assert plan["rice_kg"] == pytest.approx(650)
    assert plan["byproduct_income"] == pytest.approx(985)
    assert plan["break_even"] == pytest.approx(30.7923, abs=1e-3)
    assert plan["target_price"] == 34.5
    assert plan["recommended_price"] == 34.5
    assert plan["profit"] == pytest.approx(2410)
    assert plan["verdict"] == "good"


def test_an_exact_half_peso_is_not_pushed_up():
    plan = price_plan(**{**LOT, "palay_price": 31.05, "other_costs": 0.0, "byproducts": [], "recovery_pct": 100.0})
    assert plan["target_price"] == 34.5


def test_it_sells_at_the_market_price_when_that_is_above_break_even():
    plan = price_plan(**{**LOT, "market_price": 42.0})
    assert plan["recommended_price"] == 42.0
    assert plan["verdict"] == "good"


def test_a_profit_under_the_target_is_thin():
    plan = price_plan(**{**LOT, "market_price": 32.0})
    assert plan["verdict"] == "thin"
    assert plan["profit"] > 0


def test_a_market_at_or_below_break_even_is_a_losing_game():
    plan = price_plan(**{**LOT, "market_price": 28.0})
    assert plan["verdict"] == "losing"
    assert plan["recommended_price"] == 34.5
    assert plan["loss_per_kg"] == pytest.approx(30.7923 - 28, abs=1e-3)
    assert plan["recovery_needed_pct"] == pytest.approx(20015 / (28 * 1000) * 100)
    assert plan["max_palay_price"] == pytest.approx((28 * 650 + 985 - 1000) / 1000)


def test_wet_palay_yields_at_14_percent_but_is_paid_for_as_bought():
    plan = price_plan(**{**LOT, "moisture_pct": 22.0, "other_costs": 0.0, "byproducts": []})
    assert plan["total_cost"] == 20000
    assert plan["rice_kg"] == pytest.approx(1000 * 78 / 86 * 0.65)


def test_drier_palay_stays_as_weighed():
    assert price_plan(**{**LOT, "moisture_pct": 12.0})["rice_kg"] == pytest.approx(650)


@pytest.mark.parametrize("change", [{"recovery_pct": 0.0}, {"palay_kg": 0.0, "other_costs": 0.0}])
def test_no_plan_without_rice_to_price_or_a_cost_to_cover(change):
    assert price_plan(**{**LOT, **change}) is None


def test_staff_see_their_share_of_the_profit_and_nothing_else():
    plan = price_plan(**LOT)
    shown = staff_view(plan, 30.0)
    assert set(shown) == {"recommended_price", "estimated_profit_per_kg", "verdict"}
    assert shown["recommended_price"] == 34.5
    assert shown["estimated_profit_per_kg"] == pytest.approx((34.5 - 30.7923) * 0.3, abs=0.01)


def test_staff_get_no_number_on_a_loss():
    shown = staff_view(price_plan(**{**LOT, "market_price": 28.0}), 30.0)
    assert shown["verdict"] == "losing"
    assert shown["estimated_profit_per_kg"] is None


def test_staff_get_no_figures_without_a_plan():
    assert staff_view(None, 30.0) == {
        "recommended_price": None,
        "estimated_profit_per_kg": None,
        "verdict": "no_data",
    }


def _user(role, *, platform_admin=False, custom=None):
    return SimpleNamespace(role=SimpleNamespace(name=role), is_platform_admin=platform_admin, custom_role=custom)


def test_only_the_mills_own_boss_counts_as_the_boss():
    assert is_boss(_user("owner"))
    assert not is_boss(_user("admin"))
    assert not is_boss(_user("accountant"))
    assert not is_boss(_user("owner", platform_admin=True))
    assert not is_boss(_user("owner", custom=object()))
    assert not is_boss(SimpleNamespace(role=None))
