"""Demo data for the Savings page: machine ratings so capacity use shows, a vale owed by
a mill's first farmer, and a humidity reading on a storage zone.

Recorded through SavingsService as the mill's owner. Idempotent: what's already there
is left as it is.

Run AFTER `alembic upgrade head` and `migrate_all_tenants.py`, and after the buying and
milling parts.

Usage, from backend/: python seed_demo.py --only savings [--all]
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from app.core.tenancy import set_search_path
from app.models.milling import MillingEquipment
from app.models.supplier_customer import Supplier, SupplierAdvance
from app.models.user import User
from app.models.warehouse import WarehouseLayout, WarehouseZone, ZoneReading
from app.services.savings_service import SavingsService


def seed(db, username: str) -> str:
    """Add the demo to one test mill; say what happened."""
    user = db.query(User).filter(User.username == username, User.company_id.is_not(None)).first()
    if not user:
        return f"{username}: not found or has no company — skipped"
    set_search_path(db, user.company.schema_name)
    done = []

    rated = 0
    for machine in db.query(MillingEquipment).filter(MillingEquipment.company_id == user.company_id).all():
        if machine.capacity_kg_per_hr is None:
            machine.capacity_kg_per_hr = Decimal("1000")
        if machine.rated_hours_per_day is None:
            machine.rated_hours_per_day = Decimal("10")
            rated += 1
    if rated:
        db.commit()
        done.append(f"{rated} machines rated")

    svc = SavingsService(db, user)
    supplier = db.query(Supplier).filter(Supplier.company_id == user.company_id).order_by(Supplier.name).first()
    has_vale = db.query(SupplierAdvance.id).filter(SupplierAdvance.company_id == user.company_id).first()
    if supplier and not has_vale:
        svc.create_advance(
            SimpleNamespace(
                supplier_id=supplier.id,
                advance_date=date.today() - timedelta(days=30),
                kind="inputs",
                amount=Decimal("15000"),
                note="Fertilizer for the wet season",
            )
        )
        done.append("a vale")

    zone = (
        db.query(WarehouseZone)
        .join(WarehouseLayout, WarehouseLayout.id == WarehouseZone.layout_id)
        .filter(WarehouseLayout.company_id == user.company_id, WarehouseZone.zone_type == "premium_storage")
        .first()
    )
    if zone and not db.query(ZoneReading.id).filter(ZoneReading.zone_id == zone.id).first():
        svc.add_reading(SimpleNamespace(zone_id=zone.id, humidity_pct=Decimal("68"), temp_c=Decimal("29"), note=None))
        done.append("a zone reading")
    return f"{username}: {', '.join(done) or 'already seeded'}"
