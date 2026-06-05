"""Moisture-based shelf-life and aging-status calculation for milled rice.

Why these thresholds: rice spoils faster at higher moisture. Published Philippine
post-harvest guidelines (PhilMech / IRRI) say ≤14% moisture is safe for
long-term storage, 15-16% is short-term only, and >16% needs immediate use.
"""
from datetime import date, timedelta
from decimal import Decimal

# (max_moisture_pct, safe_storage_days)
MOISTURE_SHELF_LIFE_DAYS: list[tuple[float, int]] = [
    (12.0, 365),  # ≤12%  → 12 months
    (13.0, 270),  # 12-13% → 9 months
    (14.0, 180),  # 13-14% → 6 months
    (15.0,  90),  # 14-15% → 3 months
    (16.0,  45),  # 15-16% → 1.5 months
    (99.0,  14),  # >16%  → 2 weeks (high spoilage risk)
]

WARNING_AT_PCT = 0.75   # orange when 75% of shelf-life elapsed
CRITICAL_AT_PCT = 0.90  # red when 90%+ elapsed


def shelf_life_days(moisture_pct: Decimal | float | None) -> int:
    """Return the safe storage window in days for the given moisture %."""
    if moisture_pct is None:
        return 180  # unknown moisture → assume 14% (mid-range)
    m = float(moisture_pct)
    for thresh, days in MOISTURE_SHELF_LIFE_DAYS:
        if m <= thresh:
            return days
    return 14


def compute_best_before(milling_date: date, moisture_pct: Decimal | float | None) -> date:
    return milling_date + timedelta(days=shelf_life_days(moisture_pct))


def aging_status(
    milling_date: date,
    moisture_pct: Decimal | float | None,
    today: date | None = None,
) -> str:
    """Return one of: 'fresh' | 'warning' | 'critical' | 'expired'."""
    today = today or date.today()
    total = shelf_life_days(moisture_pct)
    elapsed = (today - milling_date).days
    if total <= 0:
        return "expired"
    pct = elapsed / total
    if pct >= 1.0:
        return "expired"
    if pct >= CRITICAL_AT_PCT:
        return "critical"
    if pct >= WARNING_AT_PCT:
        return "warning"
    return "fresh"


def days_until_expiry(
    milling_date: date,
    moisture_pct: Decimal | float | None,
    today: date | None = None,
) -> int:
    """Days remaining until best_before_date. Negative if already expired."""
    today = today or date.today()
    return (compute_best_before(milling_date, moisture_pct) - today).days
