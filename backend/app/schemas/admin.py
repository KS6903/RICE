"""Pydantic request schemas for the platform-admin domain (Phase 3). Moved verbatim."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class PlanUpsert(BaseModel):
    code: str
    name: str
    description: str | None = None
    monthly_price: float = 0
    annual_price: float = 0
    max_users: int | None = None
    max_branches: int | None = None
    features: list[str] = []
    is_active: bool = True
    sort_order: int = 0


class SubscriptionAssign(BaseModel):
    plan_id: uuid.UUID
    status: str = "active"  # active, trial, past_due, cancelled, expired
    expires_at: datetime | None = None
    trial_ends_at: datetime | None = None
    notes: str | None = None


class SubscriptionActivate(BaseModel):
    plan_id: uuid.UUID | None = None
    notes: str | None = None
    clear_expiry: bool = True


class TenantActiveToggle(BaseModel):
    is_active: bool


class UpgradeRequestResolution(BaseModel):
    admin_note: str | None = None
