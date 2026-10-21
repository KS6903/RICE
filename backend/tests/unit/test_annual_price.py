"""The annual price the platform console shows is 12 months less the discount."""

from decimal import Decimal

import pytest

from app.services.subscription import annual_discount, annual_price


@pytest.mark.parametrize(
    ("monthly", "discount", "expected"),
    [
        (699, 16.6667, 6990),  # the seeded plans at "two months free"
        (1499, 16.6667, 14990),
        (4999, 16.6667, 49990),
        (1000, 0, 12000),
        (1000, 15, 10200),
        (999, 12.5, 10490),  # 10,489.50 rounds up
        (0, 50, 0),
    ],
)
def test_annual_price(monthly, discount, expected):
    assert annual_price(monthly, discount) == Decimal(expected)


def test_discount_is_kept_to_four_places():
    assert annual_discount(16.666666) == Decimal("16.6667")
    assert annual_discount(0) == Decimal("0.0000")
