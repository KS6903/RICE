"""An email address for each test mill's Boss login, so the Boss can download a
backup (Settings → Your data). A backup is sealed to the owner's email and
refused without one, and the test logins were made with none.

The address is <login>@example.com: example.com is reserved for examples
(RFC 2606), so no real person gets the mail, and the local backend sends no
email anyway. It's marked confirmed, so sign-in asks for no verification
step, and a backup made here can also be loaded back.

Idempotent: a Boss who already has an email keeps it.

Usage, from backend/: python seed_demo.py --only email [--all]
"""

from __future__ import annotations

from app.models.user import User

DOMAIN = "example.com"


def seed(db, username: str) -> str:
    """Give one test mill's Boss an email if they have none; say what happened."""
    owner = db.query(User).filter(User.username == username).first()
    if owner is None:
        return f"{username}: not found — skipped"
    if owner.email:
        return f"{username}: already has an email"
    address = f"{username}@{DOMAIN}"
    taken = db.query(User).filter(User.email == address, User.id != owner.id).first()
    if taken is not None:
        return f"{username}: {address} belongs to {taken.username} — skipped"
    owner.email = address
    owner.email_verified = True
    db.commit()
    return f"{username}: email {address}"
