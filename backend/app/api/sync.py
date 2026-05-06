import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.sync import SyncLog, SyncConflict

router = APIRouter()


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


@router.post("/push")
def sync_push(body: SyncPushRequest, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    synced = 0

    for record in body.records:
        log = SyncLog(
            company_id=current_user.company_id,
            table_name=record.table_name,
            record_id=record.record_id,
            operation=record.operation,
            payload=record.payload,
            client_id=body.client_id,
            synced_at=datetime.now(timezone.utc),
        )
        db.add(log)
        synced += 1

    db.commit()
    return {"synced": synced, "conflicts": 0}


@router.get("/pull")
def sync_pull(since: datetime, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    logs = db.query(SyncLog).filter(
        SyncLog.company_id == current_user.company_id,
        SyncLog.synced_at > since,
    ).order_by(SyncLog.synced_at).limit(500).all()
    return {
        "records": [
            {
                "table_name": l.table_name,
                "record_id": str(l.record_id),
                "operation": l.operation,
                "payload": l.payload,
                "synced_at": l.synced_at.isoformat(),
            }
            for l in logs
        ],
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/conflicts")
def list_conflicts(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(SyncConflict).filter(
        SyncConflict.company_id == current_user.company_id,
        SyncConflict.resolved_at.is_(None),
    ).all()


@router.put("/conflicts/{conflict_id}/resolve")
def resolve_conflict(conflict_id: uuid.UUID, body: ConflictResolution, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    conflict = db.get(SyncConflict, conflict_id)
    if not conflict or conflict.company_id != current_user.company_id:
        return {"resolved": False}
    conflict.resolved_at = datetime.now(timezone.utc)
    conflict.resolved_by = current_user.id
    conflict.resolution = body.resolution
    db.commit()
    return {"resolved": True}
