"""Maintenance HTTP controller (Enterprise, with the automations): the mill's
machines, their service intervals, how much they've been used since their last
service, and the services done.

Anyone with milling access sees it; adding machines and recording services
needs milling write access.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from ..automations import maintenance
from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..core.timezones import tenant_zone
from ..models.maintenance import Equipment, MaintenanceLog
from ..models.user import User

router = APIRouter(dependencies=[Depends(require_feature("automations")), Depends(require_section_access("milling"))])
write = [Depends(require_section_access("milling", write=True))]


class EquipmentIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    # The Catalog machine this is: then it counts only the batches run on it.
    milling_equipment_id: uuid.UUID | None = None
    every_hours: int | None = Field(None, ge=1, le=100_000)
    every_tonnes: Decimal | None = Field(None, gt=0, le=1_000_000, max_digits=10, decimal_places=1)
    every_days: int | None = Field(None, ge=1, le=3_650)
    last_service_on: date
    notes: str = Field("", max_length=500)
    is_active: bool = True

    @model_validator(mode="after")
    def _some_interval(self) -> "EquipmentIn":
        if not (self.every_hours or self.every_tonnes or self.every_days):
            raise ValueError("Give at least one interval: running hours, tonnes milled, or days.")
        return self


class ServiceIn(BaseModel):
    done_on: date
    note: str = Field("", max_length=500)


def _out(db: Session, e: Equipment, today: date, zone) -> dict:
    use = maintenance.usage(db, e, today, zone)
    return {
        "id": str(e.id),
        "name": e.name,
        "milling_equipment_id": str(e.milling_equipment_id) if e.milling_equipment_id else None,
        "every_hours": e.every_hours,
        "every_tonnes": float(e.every_tonnes) if e.every_tonnes is not None else None,
        "every_days": e.every_days,
        "last_service_on": e.last_service_on.isoformat(),
        "notes": e.notes,
        "is_active": e.is_active,
        "used": {"hours": round(float(use.hours), 1), "tonnes": round(float(use.tonnes), 1), "days": use.days},
        "status": use.status(e) if e.is_active else "off",
        "summary": use.describe(e),
    }


def _now(user) -> tuple[date, object]:
    zone = tenant_zone(user.company.timezone)
    return datetime.now(zone).date(), zone


def _machine(db: Session, equipment_id: uuid.UUID) -> Equipment:
    e = db.get(Equipment, equipment_id)
    if e is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such machine")
    return e


@router.get("/")
def list_equipment(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    today, zone = _now(current_user)
    machines = db.query(Equipment).order_by(Equipment.is_active.desc(), Equipment.name).all()
    return {"equipment": [_out(db, e, today, zone) for e in machines]}


@router.post("/", status_code=status.HTTP_201_CREATED, dependencies=write)
def add_equipment(body: EquipmentIn, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    e = Equipment(company_id=current_user.company_id, **body.model_dump(exclude={"notes"}), notes=body.notes or None)
    db.add(e)
    db.commit()
    today, zone = _now(current_user)
    return _out(db, e, today, zone)


@router.put("/{equipment_id}", dependencies=write)
def edit_equipment(
    equipment_id: uuid.UUID, body: EquipmentIn, current_user=Depends(get_current_user), db: Session = Depends(get_db)
):
    e = _machine(db, equipment_id)
    # exclude_unset for the link: a form that doesn't send it keeps it.
    link = body.model_dump(exclude_unset=True, include={"milling_equipment_id"})
    for name, value in {**body.model_dump(exclude={"notes", "milling_equipment_id"}), **link}.items():
        setattr(e, name, value)
    e.notes = body.notes or None
    db.commit()
    today, zone = _now(current_user)
    return _out(db, e, today, zone)


class LinkIn(BaseModel):
    milling_equipment_id: uuid.UUID | None = None


@router.post("/{equipment_id}/link", dependencies=write)
def link_machine(
    equipment_id: uuid.UUID, body: LinkIn, current_user=Depends(get_current_user), db: Session = Depends(get_db)
):
    e = _machine(db, equipment_id)
    e.milling_equipment_id = body.milling_equipment_id
    db.commit()
    today, zone = _now(current_user)
    return _out(db, e, today, zone)


@router.post("/{equipment_id}/service", dependencies=write)
def record_service(
    equipment_id: uuid.UUID, body: ServiceIn, current_user=Depends(get_current_user), db: Session = Depends(get_db)
):
    e = _machine(db, equipment_id)
    today, zone = _now(current_user)
    if body.done_on > today:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A service can't be in the future.")
    db.add(
        MaintenanceLog(
            company_id=current_user.company_id,
            equipment_id=e.id,
            done_on=body.done_on,
            note=body.note.strip() or None,
            done_by=current_user.id,
        )
    )
    if body.done_on >= e.last_service_on:
        e.last_service_on = body.done_on  # use is counted from here again
    db.commit()
    return _out(db, e, today, zone)


@router.get("/{equipment_id}/log")
def service_log(equipment_id: uuid.UUID, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    _machine(db, equipment_id)
    users = {u.id: u for u in db.query(User).filter(User.company_id == current_user.company_id)}
    rows = (
        db.query(MaintenanceLog)
        .filter(MaintenanceLog.equipment_id == equipment_id)
        .order_by(MaintenanceLog.done_on.desc(), MaintenanceLog.created_at.desc())
        .limit(30)
        .all()
    )
    return {
        "log": [
            {
                "id": str(r.id),
                "done_on": r.done_on.isoformat(),
                "note": r.note,
                "done_by": (users[r.done_by].full_name or users[r.done_by].username) if r.done_by in users else None,
            }
            for r in rows
        ]
    }
