"""seed_demo_staff.py: each test mill's staff logins, never more than its plan
has seats for, and never twice."""

from __future__ import annotations

import seed_demo_staff
from app.models.subscription import Subscription
from app.models.user import Role, User


def _staff(db_session, owner) -> dict[str, str]:
    rows = db_session.query(User).filter(User.company_id == owner.company_id, User.id != owner.id).all()
    return {u.username: u.role.name for u in rows}


def test_staff_fill_the_plan_in_order_and_stop(db_session, seed_owner):
    db_session.add_all([Role(id=3, name="mill_operator"), Role(id=4, name="accountant")])
    db_session.add_all([Role(id=5, name="cashier"), Role(id=6, name="encoder")])
    sub = db_session.query(Subscription).filter_by(company_id=seed_owner.company_id).one()
    sub.plan.max_users = 3  # Free: the Boss and two more
    db_session.flush()

    said = seed_demo_staff.seed(db_session, "owner")
    assert _staff(db_session, seed_owner) == {"owner.cashier": "cashier", "owner.encoder": "encoder"}
    assert "no room" in said and "owner.accountant" in said

    # Again: nothing new, nothing doubled.
    seed_demo_staff.seed(db_session, "owner")
    assert len(_staff(db_session, seed_owner)) == 2

    # A bigger plan makes room for the rest.
    sub.plan.max_users = None
    db_session.flush()
    seed_demo_staff.seed(db_session, "owner")
    assert _staff(db_session, seed_owner) == {
        "owner.cashier": "cashier",
        "owner.encoder": "encoder",
        "owner.accountant": "accountant",
        "owner.operator": "mill_operator",
    }


def test_mill1_keeps_its_plain_logins():
    assert [seed_demo_staff.staff_login("mill1", r, s) for r, s, _ in seed_demo_staff.STAFF] == [
        "cashier",
        "encoder",
        "accountant",
        "mill.operator",
    ]
    assert seed_demo_staff.staff_login("mill2", "mill_operator", "operator") == "mill2.operator"
