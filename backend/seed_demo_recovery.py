"""Milling-recovery tests on a mill's two latest palay purchases, so the Recovery
list in a purchase's window has something to show beside the calculator.

Recorded through PaddyService as the mill's owner, as the calculator records
them. Idempotent: a purchase that already has a recovery test is left as it is.

Run AFTER `alembic upgrade head` and `migrate_all_tenants.py`, and after the
buying part (the purchases).

Usage, from backend/: python seed_demo.py --only recovery [--all]
"""

from __future__ import annotations

from decimal import Decimal

from app.core.tenancy import set_search_path
from app.models.paddy import PalayPurchase
from app.models.user import User
from app.repositories.paddy import (
    PalayInventoryRepository,
    PalayPurchaseRepository,
    QualityGradeRepository,
    RiceVarietyRepository,
    SupplierRepository,
)
from app.schemas.paddy import RecoveryIn
from app.services.paddy_service import PaddyService

# (sample kg, sample moisture %, milled rice kg, head rice kg, husk kg, bran kg)
TESTS = [("50", "14", "32.5", "26", "10", "5"), ("100", "18", "61", "44", "20", "9")]


def seed(db, username: str) -> str:
    """Add recovery tests to one test mill's latest palay purchases; say what happened."""
    user = db.query(User).filter(User.username == username, User.company_id.is_not(None)).first()
    if not user:
        return f"{username}: not found or has no company — skipped"
    set_search_path(db, user.company.schema_name)
    purchases = (
        db.query(PalayPurchase)
        .filter(PalayPurchase.company_id == user.company_id)
        .order_by(PalayPurchase.purchase_date.desc(), PalayPurchase.reference_no)
        .limit(len(TESTS))
        .all()
    )
    if not purchases:
        return f"{username}: no palay purchases (seed the buying part first) — skipped"
    svc = PaddyService(
        db,
        user,
        varieties=RiceVarietyRepository(db),
        grades=QualityGradeRepository(db),
        suppliers=SupplierRepository(db),
        purchases=PalayPurchaseRepository(db),
        inventory=PalayInventoryRepository(db),
    )
    added = 0
    for purchase, (sample, moisture, milled, head, husk, bran) in zip(purchases, TESTS):
        if purchase.recovery_tests:
            continue
        line = purchase.items[0] if purchase.items else None
        svc.record_recovery(
            purchase.id,
            RecoveryIn(
                variety_id=line.variety_id if line else None,
                sample_kg=Decimal(sample),
                sample_moisture_pct=Decimal(moisture),
                milled_kg=Decimal(milled),
                head_rice_kg=Decimal(head),
                husk_kg=Decimal(husk),
                bran_kg=Decimal(bran),
            ),
        )
        added += 1
    return f"{username}: {added} recovery test(s)" if added else f"{username}: recovery tests already seeded"
