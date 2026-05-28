"""
Reset passwords for all non-platform-admin users to a known value.
Touches ONLY password_hash. Does not modify any other field.
Usage: python reset_passwords.py
"""
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.user import User

NEW_PASSWORD = "password123"


def main():
    db = SessionLocal()
    try:
        users = db.query(User).filter(User.is_platform_admin == False).all()
        if not users:
            print("(no non-admin users found)")
            return

        new_hash = hash_password(NEW_PASSWORD)
        for u in users:
            u.password_hash = new_hash

        db.commit()
        print(f"Reset password for {len(users)} user(s) to: {NEW_PASSWORD}\n")
        print("Affected usernames:")
        for u in users:
            print(f"  - {u.username}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
