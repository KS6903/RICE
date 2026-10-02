"""Tenant records a recipe's settings can point at."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from ..models.user import User
from ..models.user_location import UserLocation


def saved_locations(db: Session, company_id: uuid.UUID) -> list[UserLocation]:
    """Weather locations saved by the tenant's users, defaults first.

    user_locations is a public table keyed by user, so the tenant is enforced
    here through the user: a location id copied from another tenant matches
    nothing."""
    return (
        db.query(UserLocation)
        .join(User, User.id == UserLocation.user_id)
        .filter(User.company_id == company_id)
        .order_by(UserLocation.is_default.desc(), UserLocation.label)
        .all()
    )
