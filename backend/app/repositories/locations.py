"""Repository for saved user locations (Phase 3). Scoped by user_id, not company."""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import select, update

from ..models.user_location import UserLocation
from .base import BaseRepository


class UserLocationRepository(BaseRepository[UserLocation]):
    model = UserLocation

    def list_for_user(self, user_id: uuid.UUID) -> Sequence[UserLocation]:
        stmt = (
            select(UserLocation)
            .where(UserLocation.user_id == user_id)
            .order_by(UserLocation.is_default.desc(), UserLocation.created_at.asc())
        )
        return self.db.execute(stmt).scalars().all()

    def get_for_user(self, location_id: uuid.UUID, user_id: uuid.UUID) -> UserLocation | None:
        loc = self.db.get(UserLocation, location_id)
        if loc is None or loc.user_id != user_id:
            return None
        return loc

    def find_by_label(self, user_id: uuid.UUID, label: str) -> UserLocation | None:
        stmt = select(UserLocation).where(UserLocation.user_id == user_id, UserLocation.label == label)
        return self.db.execute(stmt).scalars().first()

    def has_any(self, user_id: uuid.UUID) -> bool:
        stmt = select(UserLocation.id).where(UserLocation.user_id == user_id).limit(1)
        return self.db.execute(stmt).first() is not None

    def clear_defaults(self, user_id: uuid.UUID, *, except_id: uuid.UUID | None = None) -> None:
        stmt = update(UserLocation).where(UserLocation.user_id == user_id)
        if except_id is not None:
            stmt = stmt.where(UserLocation.id != except_id)
        self.db.execute(stmt.values(is_default=False))

    def oldest_for_user(self, user_id: uuid.UUID) -> UserLocation | None:
        stmt = select(UserLocation).where(UserLocation.user_id == user_id).order_by(UserLocation.created_at.asc())
        return self.db.execute(stmt).scalars().first()
