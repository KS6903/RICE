"""
Run this after `alembic upgrade head` to seed initial reference data.
Usage: cd backend && .venv/Scripts/python seed.py
"""
from app.core.database import SessionLocal
from app.models.user import Role
from app.models.reference import RiceVariety, QualityGrade, ByproductType
from app.core.security import hash_password

ROLES = [
    (1, "owner"), (2, "admin"), (3, "mill_operator"),
    (4, "accountant"), (5, "cashier"), (6, "encoder"),
]

VARIETIES = [
    ("Rc222", "NSIC Rc222", "inbred", 66.0),
    ("Rc216", "NSIC Rc216", "inbred", 65.0),
    ("Rc218", "NSIC Rc218", "inbred", 65.0),
    ("Rc298", "NSIC Rc298", "inbred", 66.0),
    ("PSB14", "PSB Rc14", "inbred", 64.0),
    ("SINAG", "Sinag (Hybrid)", "hybrid", 68.0),
    ("MESTIZO", "Mestizo (Hybrid)", "hybrid", 68.0),
    ("LOCAL", "Local Variety", "local", 62.0),
]

GRADES = [
    ("A", "Grade A", 0.0, 14.0),
    ("B", "Grade B", 14.1, 18.0),
    ("C", "Grade C", 18.1, 22.0),
    ("NFA1", "NFA Grade 1", 0.0, 14.0),
    ("NFA2", "NFA Grade 2", 14.1, 18.0),
]

BYPRODUCTS = [(1, "ipa", "Ipa (Rice Hull)"), (2, "darak", "Darak (Rice Bran)"), (3, "binlid", "Binlid (Broken Rice)")]


def seed():
    db = SessionLocal()
    try:
        for role_id, name in ROLES:
            if not db.get(Role, role_id):
                db.add(Role(id=role_id, name=name))

        for code, name, cat, rec in VARIETIES:
            if not db.query(RiceVariety).filter_by(code=code, company_id=None).first():
                db.add(RiceVariety(code=code, name=name, category=cat, typical_recovery_pct=rec))

        for code, name, mn, mx in GRADES:
            if not db.query(QualityGrade).filter_by(code=code, company_id=None).first():
                db.add(QualityGrade(code=code, name=name, min_moisture_pct=mn, max_moisture_pct=mx))

        for bp_id, bp_name, local in BYPRODUCTS:
            if not db.get(ByproductType, bp_id):
                db.add(ByproductType(id=bp_id, name=bp_name, local_name=local))

        db.commit()
        print("Seed data inserted successfully.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
