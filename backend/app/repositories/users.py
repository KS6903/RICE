"""Repository for the users domain (Phase 3)."""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import select

from ..models.user import User
from .base import BaseRepository


class UserRepository(BaseRepository[User]):
    model = User

    def list_for_company(self, company_id: uuid.UUID) -> Sequence[User]:
        return self.db.execute(select(User).where(User.company_id == company_id)).scalars().all()

    def get_by_username(self, username: str) -> User | None:
        """Usernames are globally unique, so this is not company-scoped."""
        return self.db.execute(select(User).where(User.username == username)).scalars().first()

    def count_active_for_company(self, company_id: uuid.UUID) -> int:
        """Users holding a seat on the plan; removed (inactive) users don't."""
        return self.db.query(User).filter(User.company_id == company_id, User.is_active.is_(True)).count()
