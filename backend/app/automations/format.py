"""How recipes write money, weights and counts, so every notice reads the same."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

KG_PER_CAVAN = Decimal(50)


def peso(amount: Decimal | float | int | None) -> str:
    return f"₱{Decimal(amount or 0):,.0f}"


def peso_exact(amount: Decimal | float | int | None) -> str:
    """Pesos and centavos, for unit prices: ₱44.50."""
    return f"₱{Decimal(amount or 0):,.2f}"


def kg(amount: Decimal | float | int | None) -> str:
    return f"{Decimal(amount or 0):,.0f} kg"


def percent(value: Decimal | float | int | None) -> str:
    """7.5%, 8% (not 8.00%)."""
    return f"{Decimal(str(value or 0)).normalize():f}%"


def plural(count: int, one: str, many: str | None = None) -> str:
    return f"{count} {one if count == 1 else (many or one + 's')}"


def local_time(at: datetime, zone: ZoneInfo) -> str:
    """'Tue 29 Sep, 14:05' in the mill's timezone."""
    return at.astimezone(zone).strftime("%a %d %b, %H:%M")
