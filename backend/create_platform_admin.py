"""Create a platform admin (SaaS owner / boss) account.

Usage:
    cd backend && .venv/Scripts/python create_platform_admin.py

Prompts for username, full name, email, and password interactively.

    cd backend && .venv/Scripts/python create_platform_admin.py --hash

Makes no account: prompts for a password and prints its bcrypt hash, for the
PLATFORM_ADMIN_PASSWORD_HASH Worker secret. That admin's password then lives in
Cloudflare, not the database (app/core/platform_admin.py).
"""

import getpass
import sys

from app.core.database import SessionLocal
from app.core.passwords import validate_password_strength
from app.core.security import hash_password
from app.models.user import User


def _ask_password() -> str:
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
    return password


def print_hash() -> None:
    print(hash_password(_ask_password()))
    print("Put that line in the Worker secret PLATFORM_ADMIN_PASSWORD_HASH, with PLATFORM_ADMIN_USERNAME.")


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
        password = _ask_password()

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
    if sys.argv[1:] == ["--hash"]:
        print_hash()
    else:
        create()
