"""The figure check: the model may round, but may not invent a figure."""

from app.automations.ai import known_numbers, unsupported_figures

FACTS = {
    "sales_php": 108800,
    "average": {"sales_php": 167293, "change_pct": -35.0},
    "palay_kg": 15317,
    "lots": [{"lot": "PP-AUTO-20261003-W1", "moisture_pct": 23.5}],
    "rice_per_kg": 51.69,
}
KNOWN = known_numbers(FACTS)


def test_figures_from_the_facts_pass_rounded_or_converted():
    assert not unsupported_figures("Sales were ₱108,800, 35% lower than the usual ₱167,293.", KNOWN)
    assert not unsupported_figures("You bought 15,317 kg (306 cavans) of palay.", KNOWN)
    assert not unsupported_figures("About ₱109k of sales, at ₱51.69/kg.", KNOWN)
    assert not unsupported_figures("Dry lot PP-AUTO-20261003-W1 first; it is at 23.5% moisture.", KNOWN)


def test_invented_figures_are_caught():
    assert unsupported_figures("Sales should reach ₱250,000 this week.", KNOWN)
    assert unsupported_figures("Raise the price to ₱58.00/kg.", KNOWN)
    assert unsupported_figures("Margins fell 12% this month.", KNOWN)


def test_small_counts_dates_and_years_are_not_checked():
    assert not unsupported_figures("Call 2 customers before 3 pm on 5 October 2026.", KNOWN)


def test_answers_are_tidied():
    from app.automations.ai import _clean

    assert _clean("Pay up to P1,678 per cavan\u2014not more.", 200) == "Pay up to ₱1,678 per cavan, not more."
    assert _clean("Lot PP-AUTO-1 first", 200) == "Lot PP-AUTO-1 first"
    assert _clean("Dry the wettest lot first using the mechanical dryer", 30) == "Dry the wettest lot first…"
