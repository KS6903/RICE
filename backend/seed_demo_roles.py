"""A role of the mill's own for each test mill, so "Who can open what" on the
Users page shows one: a Warehouse Manager who runs the stock and sees the
buying and milling that feed it, but not the money.

Nobody is given it: every test login keeps its role, and a Free mill has no
seat to spare. The Boss can try it on a new user, or delete it.

Idempotent: a mill that already has a role by that name keeps it as it is.

Usage, from backend/: python seed_demo.py --only roles [--all]
"""

from __future__ import annotations

from app.core.access_policy import clean_access
from app.models.user import CompanyRole, User

NAME = "Warehouse Manager"
ACCESS = {
    "dashboard": "full",
    "paddy": "view",
    "milling": "view",
    "inventory": "full",
    "dispatch": "view",
    "tasks": "full",
}


def seed(db, username: str) -> str:
    """Give one test mill the Warehouse Manager role if it has none; say what happened."""
    owner = db.query(User).filter(User.username == username).first()
    if owner is None or owner.company_id is None:
        return f"{username}: not found — skipped"
    exists = db.query(CompanyRole).filter(CompanyRole.company_id == owner.company_id, CompanyRole.name == NAME).first()
    if exists is not None:
        return f"{username}: already has the {NAME} role"
    db.add(CompanyRole(company_id=owner.company_id, name=NAME, access=clean_access(ACCESS)))
    db.commit()
    return f"{username}: role {NAME}"
