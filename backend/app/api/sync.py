"""Offline-sync HTTP controllers — thin routing over SyncService (Phase 3)."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user
from ..repositories.sync import SyncConflictRepository, SyncLogRepository
from ..schemas.sync import ConflictResolution, SyncPushRequest
from ..services.sync_service import SyncService

router = APIRouter()


def get_sync_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> SyncService:
    return SyncService(
        db,
        current_user,
        logs=SyncLogRepository(db),
        conflicts=SyncConflictRepository(db),
    )


@router.post("/push")
def sync_push(body: SyncPushRequest, svc: SyncService = Depends(get_sync_service)):
    return svc.push(body.client_id, body.records)


@router.get("/pull")
def sync_pull(since: datetime, svc: SyncService = Depends(get_sync_service)):
    return svc.pull(since)


@router.get("/conflicts")
def list_conflicts(svc: SyncService = Depends(get_sync_service)):
    return svc.list_conflicts()


@router.put("/conflicts/{conflict_id}/resolve")
def resolve_conflict(conflict_id: uuid.UUID, body: ConflictResolution, svc: SyncService = Depends(get_sync_service)):
    return svc.resolve_conflict(conflict_id, body.resolution)
