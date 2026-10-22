"""Seed the Milling page's Client column for a test tenant.

Custom milling: the two oldest demo batches become batches milled for a
customer's palay, using the customers the base or sales demo already made, so
the Client column shows names and terms (one walk-in, one contracted) next to
the mill's own batches. Their stock was counted when the base demo made them as
the mill's own; this only relabels them. Skipped when any batch already has a
client.

Run AFTER `alembic upgrade head`, `migrate_all_tenants.py` and the base demo
(it needs its batches and customers).

Usage: python seed_demo_milling.py [username ...]     # default: mill1
"""

from __future__ import annotations

import sys

from app.core.tenancy import set_search_path
from app.models.milling import MillingBatch
from app.models.supplier_customer import Customer
from app.models.user import User


def seed(db, username: str) -> str:
    """Give two of one tenant's batches a client; say what happened."""
    user = db.query(User).filter(User.username == username, User.company_id.is_not(None)).first()
    if not user:
        return f"{username}: not found or has no company — skipped"
    set_search_path(db, user.company.schema_name)
    company_id = user.company_id

    batches = db.query(MillingBatch).filter(MillingBatch.company_id == company_id)
    if batches.filter(MillingBatch.customer_id.is_not(None)).count():
        return f"{username}: milling clients already seeded"
    customers = (
        db.query(Customer)
        .filter(Customer.company_id == company_id, Customer.is_active.is_(True))
        .order_by(Customer.name)
        .limit(2)
        .all()
    )
    if not customers:
        return f"{username}: milling clients skipped (no customers)"
    oldest = batches.order_by(MillingBatch.start_datetime).limit(2).all()
    if not oldest:
        return f"{username}: milling clients skipped (no batches)"
    terms = [
        ("client_takes_all", "Walk-in, picks up the bigas the same day"),
        ("contracted", "₱150 per cavan, paid on pickup"),
    ]
    for i, batch in enumerate(oldest):
        batch.customer_id = customers[i % len(customers)].id
        batch.client_arrangement, batch.client_notes = terms[i % len(terms)]
    db.commit()
    return f"{username}: {len(oldest)} batch(es) milled for a client"


def main() -> None:
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        for username in sys.argv[1:] or ["mill1"]:
            print(seed(db, username))
    finally:
        db.close()


if __name__ == "__main__":
    main()
