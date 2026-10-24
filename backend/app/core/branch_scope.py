"""Which branch the Boss is looking at, for one request.

A mill with more than one branch shows one branch at a time, or all of them
added up: the picker in the web app's top bar. The app names the choice in the
X-Branch header, a branch id or "all", on every request. Only the Boss and
Admins choose; anyone else sees what they always have. Without the header (the
desktop app, an older page) nothing changes either: the mill's records, all
branches together.

The choice rides on the request's database session (``db.info``), so the
repositories that list a branch's records filter by it (``only_viewed``)
without every route passing it on. A chosen branch is also where the Boss's new
records go, for this request only: ``set_committed_value`` puts it on the
signed-in user in memory, and the user row itself never changes. With "all",
new records go to the Boss's own branch, as before.
"""

from __future__ import annotations

import uuid
from typing import Any, TypeVar

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

HEADER = "X-Branch"
ALL = "all"
# The roles that pick a branch; the users the picker is for.
CHOOSERS = frozenset({"owner", "admin"})
_VIEW = "oraiza.branch_view"

Q = TypeVar("Q")


def chooses(user: Any) -> bool:
    role = getattr(user, "role", None)
    return bool(role and role.name in CHOOSERS and getattr(user, "company_id", None))


def resolve(db: Session, header: str | None, user: Any) -> None:
    """Apply the X-Branch header to this request. A header naming no live
    branch of the user's mill is ignored, so it can never reach another mill's."""
    if not header or header == ALL or not chooses(user):
        return
    try:
        branch_id = uuid.UUID(header)
    except ValueError:
        return
    from ..models.company import Branch

    branch = db.get(Branch, branch_id)
    if branch is None or branch.company_id != user.company_id or branch.deleted_at is not None:
        return
    db.info[_VIEW] = branch.id
    set_committed_value(user, "branch_id", branch.id)


def resolve_request(db: Session, request: Any, user: Any) -> None:
    """``resolve`` for the request's own X-Branch header (security.get_current_user)."""
    resolve(db, request.headers.get(HEADER), user)


def viewed_branch(db: Session) -> uuid.UUID | None:
    """The branch this request looks at, or None for all of them."""
    return db.info.get(_VIEW)


def only_viewed(query: Q, column: Any, db: Session) -> Q:
    """``query`` kept to the viewed branch (by ``column``), when one is chosen."""
    branch = viewed_branch(db)
    return query.where(column == branch) if branch is not None else query  # type: ignore[attr-defined]
