"""Generate 12 demo pallets in a tenant's first branch.

Useful for showcasing the spatial canva without needing real milling history.
Run AFTER `alembic upgrade head`. Idempotent: skips a layout that already has
pallets. (seed_demo.py's base part seeds pallets too; this one adds a denser,
aged set to one premium zone.)

Usage: python seed_demo_pallets.py [username ...]     # default: mill1
"""

from datetime import date, timedelta
from decimal import Decimal
from random import choice, uniform

from app.core.database import SessionLocal
from app.core.tenancy import set_search_path
from app.models.company import Branch
from app.models.reference import RiceVariety
from app.models.user import User
from app.models.warehouse import Pallet, RiceBatch, WarehouseZone
from app.repositories.canva import WarehouseLayoutRepository
from app.services.canva_bootstrap import (
    _next_pallet_code,
    bootstrap_layout,
    bootstrap_pallets_from_inventory,
)
from app.services.rice_shelf_life import aging_status, compute_best_before

VARIETIES = ["Rc222", "Rc216", "Rc218", "SINAG"]
CLIENT_NAMES = ["Juan Cruz Farms", "Lola Maria Co-op", "Pedro Reyes Hacienda", "Mill stock"]


def seed(username: str) -> str:
    """Seed one tenant's pallets; say what happened."""
    db = SessionLocal()
    try:
        # The named tenant. It used to take the first tenant it found, whatever
        # was asked for.
        user = db.query(User).filter(User.username == username, User.company_id.is_not(None)).first()
        if not user:
            return f"{username}: not found or has no company — skipped"
        # Domain tables live in this client's schema — point the session at it.
        set_search_path(db, user.company.schema_name)
        branch = db.query(Branch).filter(Branch.company_id == user.company_id).first()
        if not branch:
            return f"{username}: no branch — skipped"

        layout = WarehouseLayoutRepository(db).get_default_for_branch(branch.id)
        if not layout:
            layout = bootstrap_layout(db, branch, is_default=True)
            bootstrap_pallets_from_inventory(db, layout)
            db.commit()
            db.refresh(layout)
        premium = (
            db.query(WarehouseZone)
            .filter(
                WarehouseZone.layout_id == layout.id,
                WarehouseZone.zone_type == "premium_storage",
            )
            .first()
        )
        if not premium:
            return f"{username}: no premium_storage zone — skipped"

        existing = db.query(Pallet).filter(Pallet.layout_id == layout.id).count()
        if existing > 0:
            return f"{username}: layout already has {existing} pallets — skipped"

        varieties = db.query(RiceVariety).filter(RiceVariety.code.in_(VARIETIES)).all()
        if not varieties:
            return f"{username}: no varieties (run seed.py first) — skipped"

        today = date.today()
        cols = 6
        spacing_x = 1.5
        spacing_y = 1.1
        start_x = float(premium.x_m) + 0.4
        start_y = float(premium.y_m) + 0.7

        created = 0
        for i in range(12):
            row = i // cols
            col = i % cols
            x = start_x + col * spacing_x
            y = start_y + row * spacing_y

            sack_count = choice([20, 25, 25, 30])
            weight_kg = sack_count * 50
            variety = choice(varieties)
            client_name = choice(CLIENT_NAMES)
            client_type = "mill_own" if client_name == "Mill stock" else "supplier"
            # Spread ages so we see all 4 colors
            age_days = choice([5, 30, 60, 90, 140, 175, 200])
            milled = today - timedelta(days=age_days)
            moisture = Decimal(str(round(uniform(12.5, 15.5), 1)))
            best_before = compute_best_before(milled, moisture)
            status = aging_status(milled, moisture, today)

            pallet = Pallet(
                company_id=branch.company_id,
                layout_id=layout.id,
                zone_id=premium.id,
                pallet_code=_next_pallet_code(db, branch.company_id),
                x_m=Decimal(str(round(x, 2))),
                y_m=Decimal(str(round(y, 2))),
                z_layer=0,
                width_m=Decimal("2.0"),
                depth_m=Decimal("1.2"),
                sack_count=sack_count,
                weight_kg=Decimal(str(weight_kg)),
                status="in_storage",
            )
            db.add(pallet)
            db.flush()
            db.add(
                RiceBatch(
                    company_id=branch.company_id,
                    pallet_id=pallet.id,
                    variety_id=variety.id,
                    client_type=client_type,
                    client_name=client_name,
                    sack_count=sack_count,
                    weight_kg=Decimal(str(weight_kg)),
                    moisture_pct=moisture,
                    milling_date=milled,
                    best_before_date=best_before,
                    status=status,
                    notes=f"Demo pallet — {age_days}d aged",
                )
            )
            created += 1

        db.commit()
        return f"{username}: {created} demo pallets in {branch.name} ({layout.name})"
    finally:
        db.close()


def main() -> None:
    import sys

    for username in sys.argv[1:] or ["mill1"]:
        print(seed(username))


if __name__ == "__main__":
    main()
