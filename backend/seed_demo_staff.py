"""Staff logins for the test tenants: the four roles under the Boss that mill1
has (cashier, encoder, accountant, mill operator), as far as each mill's plan
has room for them.

The plan's user limit counts the Boss, and seats are filled in STAFF order, so
a Free mill (3 users) gets a cashier and an encoder and nothing more; Basic and
up get all four. Removed users don't take a seat.

Usernames are unique across every mill. mill1's staff were made by hand before
this seeder, under plain names (cashier, encoder, accountant, mill.operator);
every other mill's are prefixed with its login: mill2.cashier, mill2.encoder,
mill2.accountant, mill2.operator. Password: password123, as for the Boss
logins. No email, so first sign-in has no verification step.

Idempotent: a login that already exists is left as it is, removed or not.

Usage, from backend/: python seed_demo.py --only staff [--all]
"""

from __future__ import annotations

from app.core.security import hash_password
from app.models.subscription import Subscription
from app.models.user import Role, User

# (role, username suffix, full name), in the order seats are filled.
STAFF = [
    ("cashier", "cashier", "Pedro Reyes"),
    ("encoder", "encoder", "Ana Gomez"),
    ("accountant", "accountant", "Maria Santos"),
    ("mill_operator", "operator", "Juan dela Cruz"),
]
MILL1_LOGINS = {
    "cashier": "cashier",
    "encoder": "encoder",
    "accountant": "accountant",
    "mill_operator": "mill.operator",
}
PASSWORD = "password123"


def staff_login(owner: str, role: str, suffix: str) -> str:
    """The staff member's username: mill1's existing plain one, else <owner>.<suffix>."""
    if owner == "mill1":
        return MILL1_LOGINS[role]
    return f"{owner}.{suffix}"


def seed(db, username: str) -> str:
    """Add one tenant's staff logins, up to its plan's user limit; say what happened."""
    owner = db.query(User).filter(User.username == username).first()
    if not owner or not owner.company_id:
        return f"{username}: not found or has no company — skipped"
    sub = db.query(Subscription).filter(Subscription.company_id == owner.company_id).first()
    plan = sub.plan if sub else None
    limit = plan.max_users if plan else None
    seats_taken = db.query(User).filter(User.company_id == owner.company_id, User.is_active.is_(True)).count()
    roles = {r.name: r for r in db.query(Role).all()}

    added: list[str] = []
    present: list[str] = []
    no_room: list[str] = []
    for role_name, suffix, full_name in STAFF:
        login = staff_login(username, role_name, suffix)
        existing = db.query(User).filter(User.username == login).first()
        if existing is not None:
            if existing.company_id != owner.company_id:
                return f"{username}: {login} belongs to another company — skipped"
            present.append(login)
            continue
        if limit is not None and seats_taken >= limit:
            no_room.append(login)
            continue
        role = roles.get(role_name)
        if role is None:
            return f"{username}: no {role_name} role (run seed.py first) — skipped"
        db.add(
            User(
                company_id=owner.company_id,
                branch_id=owner.branch_id,
                username=login,
                email=None,
                password_hash=hash_password(PASSWORD),
                full_name=full_name,
                role_id=role.id,
                is_active=True,
            )
        )
        seats_taken += 1
        added.append(login)
    db.commit()

    said = [f"added {', '.join(added)}" if added else "nothing new"]
    if present:
        said.append(f"already there: {', '.join(present)}")
    if no_room:
        said.append(f"no room on the {plan.name if plan else 'current'} plan ({limit} users) for {', '.join(no_room)}")
    return f"{username}: " + "; ".join(said)
