"""Fleet HTTP controllers — trucks, drivers, and dispatch trips."""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..repositories.fleet import DriverRepository, TripRepository, TruckRepository
from ..schemas.fleet import DriverCreate, DriverUpdate, TripCreate, TripUpdate, TruckCreate, TruckUpdate
from ..services.fleet_service import FleetService

router = APIRouter(
    dependencies=[
        Depends(require_feature("dispatch")),
        Depends(require_section_access("dispatch")),
    ]
)


def get_fleet_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> FleetService:
    return FleetService(
        db,
        current_user,
        drivers=DriverRepository(db),
        trucks=TruckRepository(db),
        trips=TripRepository(db),
    )


# ── Drivers ───────────────────────────────────────────────────────────────────


@router.get("/fleet/drivers")
def list_drivers(include_inactive: bool = False, svc: FleetService = Depends(get_fleet_service)):
    return svc.list_drivers(include_inactive=include_inactive)


@router.post(
    "/fleet/drivers",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("dispatch", write=True))],
)
def create_driver(body: DriverCreate, svc: FleetService = Depends(get_fleet_service)):
    return svc.create_driver(body)


@router.put("/fleet/drivers/{driver_id}", dependencies=[Depends(require_section_access("dispatch", write=True))])
def update_driver(driver_id: uuid.UUID, body: DriverUpdate, svc: FleetService = Depends(get_fleet_service)):
    return svc.update_driver(driver_id, body)


# ── Trucks ────────────────────────────────────────────────────────────────────


@router.get("/fleet/trucks")
def list_trucks(include_inactive: bool = False, svc: FleetService = Depends(get_fleet_service)):
    return svc.list_trucks(include_inactive=include_inactive)


@router.post(
    "/fleet/trucks",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("dispatch", write=True))],
)
def create_truck(body: TruckCreate, svc: FleetService = Depends(get_fleet_service)):
    return svc.create_truck(body)


@router.put("/fleet/trucks/{truck_id}", dependencies=[Depends(require_section_access("dispatch", write=True))])
def update_truck(truck_id: uuid.UUID, body: TruckUpdate, svc: FleetService = Depends(get_fleet_service)):
    return svc.update_truck(truck_id, body)


# ── Trips ─────────────────────────────────────────────────────────────────────


@router.get("/fleet/trips")
def list_trips(limit: int = 100, svc: FleetService = Depends(get_fleet_service)):
    return svc.list_trips(limit=limit)


@router.post(
    "/fleet/trips",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("dispatch", write=True))],
)
def create_trip(body: TripCreate, svc: FleetService = Depends(get_fleet_service)):
    return svc.create_trip(body)


@router.put("/fleet/trips/{trip_id}", dependencies=[Depends(require_section_access("dispatch", write=True))])
def update_trip(trip_id: uuid.UUID, body: TripUpdate, svc: FleetService = Depends(get_fleet_service)):
    return svc.update_trip(trip_id, body)
