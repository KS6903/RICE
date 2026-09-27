"""Create a platform admin (SaaS owner / boss) account.

Usage:
    cd backend && .venv/Scripts/python create_platform_admin.py

Prompts for username, full name, email, and password interactively.
"""

import getpass
import sys

from app.core.database import SessionLocal
from app.core.passwords import validate_password_strength
from app.core.security import hash_password
from app.models.user import User


def create():
    print("=" * 50)
    print("  Create Platform Admin (SaaS Owner)")
    print("=" * 50)

    db = SessionLocal()
    try:
        username = input("Username: ").strip()
        if not username:
            print("ERROR: Username is required.")
            sys.exit(1)
        if db.query(User).filter(User.username == username).first():
            print(f"ERROR: Username '{username}' already exists.")
            sys.exit(1)

        full_name = input("Full name: ").strip() or "Platform Admin"
        email = input("Email: ").strip() or None
        password = getpass.getpass("Password (hidden): ")
        try:
            validate_password_strength(password)
        except Exception as exc:
            print(f"ERROR: {exc}")
            sys.exit(1)
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("ERROR: Passwords do not match.")
            sys.exit(1)

        admin = User(
            username=username,
            email=email,
            full_name=full_name,
            password_hash=hash_password(password),
            is_active=True,
            is_platform_admin=True,
            company_id=None,
            branch_id=None,
            role_id=None,
        )
        db.add(admin)
        db.commit()
        print()
        print(f"SUCCESS: Platform admin '{username}' created.")
        print("Sign in at /login on the web app and you'll be routed to /admin automatically.")
    finally:
        db.close()


if __name__ == "__main__":
    create()
