"""Pydantic request schema for tenant billing (Phase 3). Moved verbatim."""
import uuid

from pydantic import BaseModel


class UpgradeRequestCreate(BaseModel):
    plan_id: uuid.UUID
    note: str | None = None
    request_type: str = "upgrade"  # "upgrade" or "change"
