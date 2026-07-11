"""Authenticated, feature-gated offline-sync HTTP controllers."""

import uuid

from fastapi import APIRouter, Depends
from pydantic import AwareDatetime
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_roles
from ..repositories.sync import SyncConflictRepository, SyncLogRepository
from ..schemas.sync import ConflictResolution, SyncPushRequest
from ..services.sync_service import SyncService

SYNC_ROLES = ("owner", "admin", "accountant", "cashier", "mill_operator", "encoder")
MANAGE_CONFLICT_ROLES = ("owner", "admin")

router = APIRouter(
    dependencies=[
        Depends(require_feature("offline_sync")),
        # Broad fail-closed entry gate. SyncService additionally applies the
        # per-table read/write matrix because a push can mix domains.
        Depends(require_roles(*SYNC_ROLES)),
    ]
)


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
def sync_pull(since: AwareDatetime, svc: SyncService = Depends(get_sync_service)):
    return svc.pull(since)


@router.get(
    "/conflicts",
    dependencies=[Depends(require_roles(*MANAGE_CONFLICT_ROLES))],
)
def list_conflicts(svc: SyncService = Depends(get_sync_service)):
    return svc.list_conflicts()


@router.put(
    "/conflicts/{conflict_id}/resolve",
    dependencies=[Depends(require_roles(*MANAGE_CONFLICT_ROLES))],
)
def resolve_conflict(
    conflict_id: uuid.UUID,
    body: ConflictResolution,
    svc: SyncService = Depends(get_sync_service),
):
    return svc.resolve_conflict(conflict_id, body.resolution)
