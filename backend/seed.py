"""
Run this after `alembic upgrade head` to seed shared (public-schema) reference data.

Schema-per-client note: rice varieties and quality grades are now PER-CLIENT —
each company's catalog lives in its own schema and is seeded automatically when
the client is provisioned (see core.tenancy.provision_tenant / seed_reference_rows).
This script only seeds the shared public-schema reference data: roles and the
global byproduct catalog.

Usage: cd backend && .venv/Scripts/python seed.py
"""
from app.core.database import SessionLocal
from app.models.reference import ByproductType
from app.models.user import Role

ROLES = [
    (1, "owner"), (2, "admin"), (3, "mill_operator"),
    (4, "accountant"), (5, "cashier"), (6, "encoder"),
]

BYPRODUCTS = [(1, "ipa", "Ipa (Rice Hull)"), (2, "darak", "Darak (Rice Bran)"), (3, "binlid", "Binlid (Broken Rice)")]


def seed():
    db = SessionLocal()
    try:
        for role_id, name in ROLES:
            if not db.get(Role, role_id):
                db.add(Role(id=role_id, name=name))

        for bp_id, bp_name, local in BYPRODUCTS:
            if not db.get(ByproductType, bp_id):
                db.add(ByproductType(id=bp_id, name=bp_name, local_name=local))

        db.commit()
        print("Seed data inserted successfully (roles + byproduct catalog).")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
