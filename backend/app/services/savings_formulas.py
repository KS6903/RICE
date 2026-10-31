"""The sums behind the Savings page, with no database in sight: what a load of palay
is paid at, where a batch's kilos went, how to blend to a grade, the most palay can
cost, and how hard the mill runs. The blend is also in the web app's
mappers/SavingsMapper.ts, for results while typing; both are tested with the same
worked example.

Every threshold here is a default a Boss can change (``DEFAULT_SETTINGS``): mills
differ, and the rice tariff moves. EO 105 (2025) made it 15-35%, set each quarter,
so 15% is only where the setting starts, not a fact to rely on.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Iterable

STANDARD_MOISTURE_PCT = Decimal("14")

DEFAULT_SETTINGS: dict = {
    # Taken off a farmer's pay only once the Boss says so: a mill that already pays
    # less for wet palay would otherwise deduct twice.
    "pay_deductions": False,
    # A saved weight changes only with a reason, by the Boss or an admin.
    "weight_lock": True,
    "mrr_alert_pct": 63.0,
    "broken_alert_pct": 8.0,
    "unaccounted_alert_pct": 2.0,
    # The other shares of a batch. Head rice starts at the app's own 48%: 63% is the
    # recovery line, which counts brokens too.
    "head_low_pct": 48.0,
    "bran_low_pct": 8.0,
    "bran_high_pct": 10.0,
    "hull_low_pct": 18.0,
    "hull_high_pct": 22.0,
    "binlid_high_pct": 8.0,
    # A batch this many points over the machine's recent brokens is drifting.
    "broken_spike_points": 3.0,
    "break_even_utilization_pct": 63.0,
    "optimal_low_pct": 80.0,
    "optimal_high_pct": 85.0,
    "working_days_per_week": 6,
    "tariff_pct": 15.0,
    "cif_usd_per_ton": None,
    "usd_php": None,
    "landed_other_per_kg": 0.0,
    # Today's wholesale rice price, when typed; else what the mill's own sales averaged.
    "wholesale_price": None,
    # Refuse a sale under cost, unless the Boss or an admin approves it.
    "block_below_cost": False,
    # Hold new rice wetter than this, and a zone's pallets when its reading is over target.
    "hold_moisture_over": None,
    "auto_hold_readings": False,
    # Days each by-product keeps, by type; darak falls back to bran_fresh_days.
    "fresh_days": {},
    "packaging_per_sack": 0.0,
    "kg_per_sack": 50.0,
    "bran_fresh_days": 7,
}


def settings_for(company) -> dict:
    """The mill's settings over the defaults."""
    return {**DEFAULT_SETTINGS, **(getattr(company, "savings_settings", None) or {})}


def payable_weight(net_kg: Decimal, moisture_pct: Decimal | None, impurity_pct: Decimal | None) -> Decimal | None:
    """The kilos to pay for: impurities off first, then the water above 14% by the
    dry-matter ratio. None when there's nothing to take off."""
    wet = moisture_pct is not None and STANDARD_MOISTURE_PCT < moisture_pct < 100
    dirty = impurity_pct is not None and 0 < impurity_pct < 100
    if not wet and not dirty:
        return None
    kg = Decimal(net_kg)
    if dirty:
        kg = kg * (100 - impurity_pct) / 100  # type: ignore[operator]
    if wet:
        kg = kg * (100 - moisture_pct) / (100 - STANDARD_MOISTURE_PCT)  # type: ignore[operator]
    return kg.quantize(Decimal("0.001"))


def mass_balance(input_kg: float, outputs: Iterable[tuple[str, float, float | None]]) -> dict:
    """Where a batch's palay went, from (output type, kg, broken %) rows. Recovery is
    all milled rice, its brokens included, as the app has always counted it; head rice
    is the whole grains in it, known only when a broken % was recorded. ``complete`` is
    False until a by-product is recorded: without one the gap says nothing."""
    milled = head = known = binlid = darak = ipa = other = 0.0
    for kind, kg, broken in outputs:
        if kind == "milled_rice":
            milled += kg
            if broken is not None:
                head += kg * (100 - broken) / 100
                known += kg
        elif kind == "binlid":
            binlid += kg
        elif kind == "darak":
            darak += kg
        elif kind == "ipa":
            ipa += kg
        else:
            other += kg
    accounted = milled + binlid + darak + ipa + other

    def pct(kg: float) -> float | None:
        return round(kg / input_kg * 100, 2) if input_kg > 0 else None

    broken_pct = round((known - head) / known * 100, 2) if known > 0 else None
    return {
        "input_kg": input_kg,
        "milled_kg": milled,
        "recovery_pct": pct(milled),
        "head_kg": head if known else None,
        "head_pct": pct(head) if known else None,
        "broken_pct": broken_pct,
        "binlid_kg": binlid,
        "binlid_pct": pct(binlid),
        "darak_kg": darak,
        "darak_pct": pct(darak),
        "ipa_kg": ipa,
        "ipa_pct": pct(ipa),
        "other_kg": other,
        "unaccounted_kg": round(input_kg - accounted, 3),
        "unaccounted_pct": pct(input_kg - accounted),
        "complete": binlid + darak + ipa + other > 0,
    }


def batch_alerts(balance: dict, settings: dict) -> list[str]:
    """Which limits a batch broke: low_recovery, high_broken, unaccounted."""
    alerts = []
    if balance["milled_kg"] > 0 and (balance["recovery_pct"] or 0) < settings["mrr_alert_pct"]:
        alerts.append("low_recovery")
    if balance["broken_pct"] is not None and balance["broken_pct"] > settings["broken_alert_pct"]:
        alerts.append("high_broken")
    if balance["complete"] and abs(balance["unaccounted_pct"] or 0) > settings["unaccounted_alert_pct"]:
        alerts.append("unaccounted")
    return alerts


def range_alerts(balance: dict, settings: dict) -> list[str]:
    """Shares outside their ranges. A share nobody recorded says nothing."""
    alerts = []
    if balance["head_pct"] is not None and balance["head_pct"] < settings["head_low_pct"]:
        alerts.append("low_head")
    if balance["darak_kg"] > 0 and not settings["bran_low_pct"] <= balance["darak_pct"] <= settings["bran_high_pct"]:
        alerts.append("bran_range")
    if balance["ipa_kg"] > 0 and not settings["hull_low_pct"] <= balance["ipa_pct"] <= settings["hull_high_pct"]:
        alerts.append("hull_range")
    if balance["binlid_kg"] > 0 and balance["binlid_pct"] > settings["binlid_high_pct"]:
        alerts.append("binlid_high")
    return alerts


def likely_cause(alerts: Iterable[str]) -> str | None:
    """What the broken limits point to: a guide for where to look, never a finding.
    Kilos missing suggests spills or pilferage; brokens without missing kilos, the
    rollers and polishers."""
    found = set(alerts)
    if "unaccounted" in found:
        return "missing_kilos"
    if found & {"high_broken", "broken_spike", "binlid_high"}:
        return "machine"
    if "low_recovery" in found:
        return "palay_or_machine"
    return None


def fresh_days_for(kind: str, settings: dict) -> int | None:
    days = (settings.get("fresh_days") or {}).get(kind)
    if days:
        return int(days)
    return int(settings["bran_fresh_days"]) if kind == "darak" else None


def blend(head_broken_pct: float, stream_broken_pct: float, target_pct: float, total_kg: float) -> dict | None:
    """How much of a broken stream to add to head rice so the mix is at the contract's
    broken %. None when the two bins can't make that grade."""
    low, high = sorted((head_broken_pct, stream_broken_pct))
    if head_broken_pct == stream_broken_pct or not low <= target_pct <= high:
        return None
    share = (target_pct - head_broken_pct) / (stream_broken_pct - head_broken_pct)
    return {"stream_pct": share * 100, "stream_kg": total_kg * share, "head_kg": total_kg * (1 - share)}


def landed_price(
    cif_usd_per_ton: float | None, usd_php: float | None, tariff_pct: float, other_per_kg: float
) -> float | None:
    """What imported rice costs here per kg: CIF at the exchange rate, with the tariff
    on it, and port and inland costs. None until the CIF and the rate are typed."""
    if not cif_usd_per_ton or not usd_php:
        return None
    return cif_usd_per_ton * usd_php / 1000 * (1 + tariff_pct / 100) + other_per_kg


def max_palay_price(
    *,
    rice_price: float,
    recovery_pct: float,
    moisture_pct: float | None,
    byproducts: Iterable[tuple[float, float]],
    other_cost_per_kg: float,
    target_margin_pct: float,
) -> float:
    """The most a kilo of palay can cost and still earn the target margin at this rice
    price. ``byproducts`` is (% of the palay, ₱ per kg). The same sums as
    profit_service.price_plan, run backwards."""
    standard = 1.0
    if moisture_pct is not None and 14 < moisture_pct < 100:
        standard = (100 - moisture_pct) / 86
    rice_kg = standard * recovery_pct / 100
    income = rice_price * (1 - target_margin_pct / 100) * rice_kg
    income += sum(standard * pct / 100 * price for pct, price in byproducts)
    return income - other_cost_per_kg


def utilization_band(pct: float | None, settings: dict) -> str:
    """Against the break-even line and the target range."""
    if pct is None:
        return "no_data"
    if pct < settings["break_even_utilization_pct"]:
        return "below_break_even"
    if pct < settings["optimal_low_pct"]:
        return "above_break_even"
    if pct <= settings["optimal_high_pct"]:
        return "optimal"
    return "over_target"


def unsold_since(on_hand_kg: float, receipts: Iterable[tuple[object, float]]) -> object | None:
    """When the oldest stock still on hand came in, first in first out. ``receipts`` is
    (when, kg) newest first. None when the receipts recorded don't cover what's on hand:
    the rest is older than the ledger."""
    left = on_hand_kg
    oldest = None
    for when, kg in receipts:
        if left <= 0:
            break
        oldest = when
        left -= kg
    return oldest if left <= 0 else None
