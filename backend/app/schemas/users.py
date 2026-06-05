"""Pydantic request schemas for the users domain (Phase 3). Moved verbatim."""
import uuid

from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    email: str | None = None
    password: str
    full_name: str
    role_id: int
    branch_id: uuid.UUID | None = None


class UserUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    role_id: int | None = None
    is_active: bool | None = None
    branch_id: uuid.UUID | None = None
