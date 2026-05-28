"""
Lists every user in the database so we can debug why login is failing.
Usage: python list_users.py
"""
from app.core.database import SessionLocal
from app.models.user import User
from app.models.company import Company


def main():
    db = SessionLocal()
    try:
        users = db.query(User).all()
        if not users:
            print("(no users in database)")
            return
        print(f"Found {len(users)} user(s):\n")
        for u in users:
            company_name = "(no company)"
            company_active = "-"
            if u.company_id:
                c = db.get(Company, u.company_id)
                if c:
                    company_name = c.name
                    company_active = str(c.is_active)
            print(f"  username      : {u.username!r}")
            print(f"  email         : {u.email}")
            print(f"  full_name     : {u.full_name}")
            print(f"  is_active     : {u.is_active}")
            print(f"  is_platform   : {u.is_platform_admin}")
            print(f"  role_id       : {u.role_id}")
            print(f"  company       : {company_name} (active={company_active})")
            print(f"  hash prefix   : {u.password_hash[:20]}...")
            print()
    finally:
        db.close()


if __name__ == "__main__":
    main()
