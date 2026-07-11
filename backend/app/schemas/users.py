"""Pydantic request and deliberately-safe response schemas for users."""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


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


class RoleResponse(BaseModel):
    """Public role metadata used by the tenant user-management table."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class UserResponse(BaseModel):
    """Allowlisted user representation.

    Never add password hashes, MFA enrollment material/backup codes, email
    verification tokens, reset tokens, or other authentication secrets here.
    Both the service and route response models use this DTO so an ORM model can
    never be serialized wholesale by FastAPI again.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID | None
    branch_id: uuid.UUID | None
    username: str
    email: str | None
    full_name: str
    role_id: int | None
    role: RoleResponse | None
    is_active: bool
    last_login: datetime | None
    email_verified: bool
    created_at: datetime
    updated_at: datetime
