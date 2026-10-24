"""Pydantic request and deliberately-safe response schemas for users."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserCreate(BaseModel):
    username: str
    email: str | None = None
    password: str
    full_name: str
    # A built-in role, or (custom_role_id) one the mill's Boss made up: one of the two.
    role_id: int | None = None
    custom_role_id: uuid.UUID | None = None
    branch_id: uuid.UUID | None = None
    # The signed-in person's own password and, with two-factor on, a current
    # authenticator code: asked for when the role is Boss or Admin, or can
    # manage the people on the Users page.
    current_password: str | None = None
    mfa_code: str | None = None


class UserUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    role_id: int | None = None
    # Instead of role_id: a role the mill's Boss made up.
    custom_role_id: uuid.UUID | None = None
    is_active: bool | None = None
    branch_id: uuid.UUID | None = None
    # As on UserCreate: asked for when someone is given such a role.
    current_password: str | None = None
    mfa_code: str | None = None


class RoleResponse(BaseModel):
    """Public role metadata used by the tenant user-management table."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class CustomRoleResponse(BaseModel):
    """A role the mill's Boss made up, as the users table names it."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
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
    custom_role_id: uuid.UUID | None = None
    custom_role: CustomRoleResponse | None = None
    is_active: bool
    last_login: datetime | None
    email_verified: bool
    created_at: datetime
    updated_at: datetime
