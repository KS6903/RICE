"""Pydantic request schemas for the offline-sync domain (Phase 3). Moved verbatim."""
import uuid
from datetime import datetime

from pydantic import BaseModel


class SyncRecord(BaseModel):
    table_name: str
    record_id: uuid.UUID
    operation: str  # INSERT, UPDATE, DELETE
    payload: dict
    updated_at: datetime


class SyncPushRequest(BaseModel):
    client_id: str
    records: list[SyncRecord]


class ConflictResolution(BaseModel):
    resolution: str  # keep_local, keep_remote, merged
