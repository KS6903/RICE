"""How notices write money and rice."""

from decimal import Decimal

from app.automations.format import peso, peso_exact, rice_name


def test_losses_read_as_negative_pesos():
    assert peso(Decimal("-1504773.4")) == "-₱1,504,773"
    assert peso(1250) == "₱1,250"
    assert peso(None) == "₱0"
    assert peso_exact(Decimal("-3.5")) == "-₱3.50"


def test_rice_names():
    assert rice_name("NSIC Rc222", "A") == "NSIC Rc222 (grade A)"
    assert rice_name("NSIC Rc222", None) == "NSIC Rc222"
    assert rice_name(None, "A") == "Grade A"
    assert rice_name(None, None) == "Rice"
