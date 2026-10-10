"""Document numbers carry the rice mill's own short code."""

import pytest

from app.services.doc_numbers import mill_code


@pytest.mark.parametrize(
    ("name", "code"),
    [
        ("Rice Mill 1", "RM1"),
        ("Rice Mill 10", "RM10"),
        ("San Isidro Rice Mill", "SIRM"),
        ("Oryza", "ORY"),
        ("Test Mill", "TM"),
        ("Golden Harvest Rice Mill and Trading", "GHRMT"),
        ("  ", "MILL"),
        (None, "MILL"),
    ],
)
def test_mill_code(name, code):
    assert mill_code(name) == code


def test_mill_code_is_short_and_upper_case():
    code = mill_code("alpha beta gamma delta epsilon zeta eta")
    assert code == code.upper() and len(code) <= 5
