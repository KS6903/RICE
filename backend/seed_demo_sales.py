"""Seed demo sales revenue (and matching expenses) so the Annual Revenue graph
and the dashboard P&L look alive. Each tenant gets a DISTINCT revenue + expense
profile, so net profit differs from one account to the next.

- Revenue: paid SalesOrders spread across Jan..(current month) of the current
  year, ~3 orders/month, following a per-company ramp with deterministic jitter.
- Expenses: ~2 Expense rows/month at a company-specific ratio of revenue, so the
  net profit (revenue - expenses) is genuinely different per tenant.

Idempotent: a tenant is skipped if it already has demo-seeded orders
(remarks == MARKER). Safe to re-run.

Run AFTER `alembic upgrade head` and `seed.py`.

Usage:
    python seed_demo_sales.py                # mill1..mill8
    python seed_demo_sales.py mill1 mill2    # specific tenants
"""

from __future__ import annotations

import sys
from datetime import date, datetime, timezone
from decimal import Decimal

from app.core.database import SessionLocal
from app.core.tenancy import set_search_path
from app.models.company import Branch
from app.models.costs import Expense
from app.models.sales import SalesOrder
from app.models.supplier_customer import Customer
from app.models.user import User

MARKER = "demo-annual-seed"

# Per-tenant profile: (base monthly revenue ₱, expense ratio of revenue).
# Deliberately varied so each account shows a different revenue AND profit.
PROFILES: dict[str, tuple[int, float]] = {
    "mill1": (185_000, 0.35),
    "mill2": (140_000, 0.30),
    "mill3": (215_000, 0.42),
    "mill4": (95_000, 0.25),
    "mill5": (120_000, 0.45),
    "mill6": (165_000, 0.33),
    "mill7": (80_000, 0.22),
    "mill8": (135_000, 0.38),
}

# Month-over-month ramp (index 0 == January). Gives the graph an upward shape.
RAMP = [0.70, 0.82, 0.95, 1.00, 1.12, 1.28, 1.35, 1.30, 1.20, 1.15, 1.40, 1.55]


def _jitter(idx: int, month: int) -> float:
    """Deterministic ±10% wobble so bars aren't a perfectly smooth ramp."""
    return 1.0 + (((idx * 7 + month * 13) % 11) - 5) / 50.0


def seed_tenant(db, username: str, idx: int) -> str:
    user = db.query(User).filter(User.username == username).first()
    if not user or not user.company_id:
        return f"{username}: no user/company — skipped"

    # Domain tables live in this client's schema — point the session at it.
    set_search_path(db, user.company.schema_name)
    cid = user.company_id
    already = (
        db.query(SalesOrder)
        .filter(
            SalesOrder.company_id == cid,
            SalesOrder.remarks == MARKER,
        )
        .count()
    )
    if already:
        return f"{username}: already seeded ({already} orders) — skipped"

    base, exp_ratio = PROFILES.get(username, (110_000, 0.30))
    branch = db.query(Branch).filter(Branch.company_id == cid).first()
    branch_id = branch.id if branch else None
    customer = db.query(Customer).filter(Customer.company_id == cid).first()
    customer_id = customer.id if customer else None

    today = date.today()
    last_month = today.month  # seed elapsed months only (Jan..current)

    orders = 0
    expenses = 0
    total_rev = Decimal("0")
    total_exp = Decimal("0")

    for m in range(1, last_month + 1):
        month_rev = base * RAMP[m - 1] * _jitter(idx, m)

        # ~3 orders per month, splitting the monthly revenue.
        for day, frac in ((8, 0.40), (18, 0.35), (26, 0.25)):
            d = date(today.year, m, min(day, 28))
            if d > today:
                continue
            amount = Decimal(str(round(month_rev * frac, 2)))
            db.add(
                SalesOrder(
                    company_id=cid,
                    branch_id=branch_id,
                    order_no=f"SO-{d:%Y%m%d}-{idx}{orders:03d}",
                    customer_id=customer_id,
                    order_date=d,
                    delivery_date=d,
                    status="paid",
                    subtotal=amount,
                    total_amount=amount,
                    remarks=MARKER,
                    created_by=user.id,
                )
            )
            orders += 1
            total_rev += amount

        # ~2 expense rows per month at the company's ratio.
        month_exp = month_rev * exp_ratio
        for day, frac in ((10, 0.6), (22, 0.4)):
            d = date(today.year, m, min(day, 28))
            if d > today:
                continue
            amount = Decimal(str(round(month_exp * frac, 2)))
            now = datetime.now(timezone.utc)
            db.add(
                Expense(
                    company_id=cid,
                    branch_id=branch_id,
                    expense_date=d,
                    amount=amount,
                    description=f"{MARKER}: operating expense",
                    created_by=user.id,
                    created_at=now,
                    updated_at=now,
                )
            )
            expenses += 1
            total_exp += amount

    db.commit()
    net = total_rev - total_exp
    return (
        f"{username}: {orders} orders PHP {total_rev:,.0f} revenue, "
        f"{expenses} expenses PHP {total_exp:,.0f} -> net PHP {net:,.0f}"
    )


def main() -> None:
    targets = sys.argv[1:] or [f"mill{i}" for i in range(1, 9)]
    db = SessionLocal()
    try:
        for i, username in enumerate(targets, start=1):
            print(seed_tenant(db, username, i))
    finally:
        db.close()


if __name__ == "__main__":
    main()
