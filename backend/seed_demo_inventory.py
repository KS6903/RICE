"""Seed a handful of classic inventory rows (palay, milled rice, by-products)
for the first non-admin tenant. Idempotent: skips if any rows already exist
for the company.

Run AFTER `alembic upgrade head` and `seed.py`.

Usage: python seed_demo_inventory.py
"""
from decimal import Decimal
from app.core.database import SessionLocal
from app.core.tenancy import set_search_path
from app.models.company import Branch
from app.models.user import User
from app.models.reference import RiceVariety, QualityGrade
from app.models.paddy import PalayInventory
from app.models.milling import MilledRiceInventory, ByproductInventory


def main():
    db = SessionLocal()
    try:
        import sys
        target_username = sys.argv[1] if len(sys.argv) > 1 else "mill1"
        user = db.query(User).filter(User.username == target_username).first()
        if not user or not user.company_id:
            print(f"User {target_username!r} not found or has no company.")
            return
        # Domain tables live in this client's schema — point the session at it.
        set_search_path(db, user.company.schema_name)
        branch = db.query(Branch).filter(Branch.company_id == user.company_id).first()
        if not branch:
            print("No branch on this company.")
            return

        existing_palay = db.query(PalayInventory).filter(PalayInventory.company_id == branch.company_id).count()
        existing_milled = db.query(MilledRiceInventory).filter(MilledRiceInventory.company_id == branch.company_id).count()
        existing_bp = db.query(ByproductInventory).filter(ByproductInventory.company_id == branch.company_id).count()
        if existing_palay or existing_milled or existing_bp:
            print(f"Inventory already seeded (palay={existing_palay}, milled={existing_milled}, bp={existing_bp}). Skipping.")
            return

        varieties = db.query(RiceVariety).limit(3).all()
        grades = db.query(QualityGrade).limit(2).all()
        if not varieties or not grades:
            print("Need varieties + grades. Run seed.py first.")
            return

        created = 0

        # Palay rows
        for i, v in enumerate(varieties):
            db.add(PalayInventory(
                company_id=branch.company_id,
                branch_id=branch.id,
                variety_id=v.id,
                grade_id=grades[i % len(grades)].id,
                quantity_kg=Decimal("2500.0") - Decimal(str(i * 300)),
            ))
            created += 1

        # Milled rice rows
        for i, v in enumerate(varieties):
            db.add(MilledRiceInventory(
                company_id=branch.company_id,
                branch_id=branch.id,
                variety_id=v.id,
                grade_name=["premium", "regular", "broken"][i % 3],
                quantity_kg=Decimal("1750.0") - Decimal(str(i * 200)),
            ))
            created += 1

        # By-products rows
        for kind, kg in (("ipa", "850.0"), ("darak", "640.0"), ("binlid", "320.0")):
            db.add(ByproductInventory(
                company_id=branch.company_id,
                branch_id=branch.id,
                byproduct_type=kind,
                quantity_kg=Decimal(kg),
            ))
            created += 1

        db.commit()
        print(f"Seeded {created} inventory rows in {branch.name}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
