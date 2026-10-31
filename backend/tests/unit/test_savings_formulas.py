"""The Savings page's sums, with the same worked examples as the web app's
mappers/SavingsMapper.spec.ts."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.services.profit_service import price_plan
from app.services.savings_formulas import (
    DEFAULT_SETTINGS,
    batch_alerts,
    blend,
    landed_price,
    mass_balance,
    max_palay_price,
    payable_weight,
    unsold_since,
    utilization_band,
)


def test_payable_weight_takes_impurities_then_water_above_14():
    assert payable_weight(Decimal(1000), Decimal(18), Decimal(2)) == Decimal("934.419")


def test_payable_weight_leaves_dry_clean_palay_alone():
    assert payable_weight(Decimal(1000), Decimal(14), Decimal(0)) is None
    assert payable_weight(Decimal(1000), None, None) is None


def test_payable_weight_doesnt_add_for_drier_palay():
    assert payable_weight(Decimal(1000), Decimal(12), Decimal(1)) == Decimal("990.000")


def test_blend_hits_a_contract_grade():
    assert blend(2, 100, 5, 1000)["stream_pct"] == pytest.approx(3.061, abs=0.001)
    assert blend(2, 100, 25, 1000)["stream_kg"] == pytest.approx(234.694, abs=0.001)


def test_blend_says_when_the_bins_cant_make_it():
    assert blend(10, 100, 5, 1000) is None
    assert blend(5, 5, 5, 1000) is None


def test_mass_balance_accounts_for_every_kilo():
    balance = mass_balance(
        1000,
        [("milled_rice", 650, 10.0), ("ipa", 200, None), ("darak", 90, None), ("binlid", 30, None)],
    )
    assert balance["recovery_pct"] == 65.0
    assert balance["head_pct"] == 58.5
    assert balance["broken_pct"] == 10.0
    assert balance["unaccounted_kg"] == 30
    assert balance["unaccounted_pct"] == 3.0
    assert balance["complete"] is True


def test_a_gap_means_nothing_until_a_byproduct_is_recorded():
    balance = mass_balance(1000, [("milled_rice", 650, None)])
    assert balance["complete"] is False
    assert "unaccounted" not in batch_alerts(balance, DEFAULT_SETTINGS)


def test_batch_alerts_use_the_mills_limits():
    balance = mass_balance(1000, [("milled_rice", 620, 12.0), ("ipa", 200, None), ("darak", 100, None)])
    assert batch_alerts(balance, DEFAULT_SETTINGS) == ["low_recovery", "high_broken", "unaccounted"]
    relaxed = {**DEFAULT_SETTINGS, "mrr_alert_pct": 60, "broken_alert_pct": 15, "unaccounted_alert_pct": 10}
    assert batch_alerts(balance, relaxed) == []


def test_landed_price_waits_for_the_figures():
    assert landed_price(None, 57, 15, 2) is None
    assert landed_price(450, 57, 15, 2) == pytest.approx(31.4975)


def test_max_price_is_price_plan_run_backwards():
    """At the highest price, the plan breaks even at exactly the rice price's margin."""
    byproducts = [(20.0, 1.0), (10.0, 8.0)]
    most = max_palay_price(
        rice_price=45,
        recovery_pct=65,
        moisture_pct=18,
        byproducts=byproducts,
        other_cost_per_kg=2,
        target_margin_pct=0,
    )
    plan = price_plan(
        palay_kg=1000,
        palay_price=most,
        moisture_pct=18,
        recovery_pct=65,
        other_costs=2000,
        byproducts=byproducts,
        target_margin_pct=10,
        market_price=None,
    )
    assert plan["break_even"] == pytest.approx(45)


def test_utilization_bands():
    assert utilization_band(None, DEFAULT_SETTINGS) == "no_data"
    assert utilization_band(50, DEFAULT_SETTINGS) == "below_break_even"
    assert utilization_band(70, DEFAULT_SETTINGS) == "above_break_even"
    assert utilization_band(82, DEFAULT_SETTINGS) == "optimal"
    assert utilization_band(95, DEFAULT_SETTINGS) == "over_target"


def test_unsold_since_finds_the_oldest_stock_left():
    new, old = date(2026, 10, 30), date(2026, 10, 20)
    assert unsold_since(50, [(new, 100), (old, 100)]) == new
    assert unsold_since(150, [(new, 100), (old, 100)]) == old
    assert unsold_since(300, [(new, 100), (old, 100)]) is None  # older than the ledger
