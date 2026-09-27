"""Repositories for the fleet domain."""

import uuid
from typing import Sequence

from ..models.fleet import DispatchTrip, Driver, Truck
from .base import BaseRepository


class DriverRepository(BaseRepository[Driver]):
    model = Driver

    def list_for_company(self, company_id: uuid.UUID, *, include_inactive: bool = False) -> Sequence[Driver]:
        q = self.db.query(Driver).filter(Driver.company_id == company_id)
        if not include_inactive:
            q = q.filter(Driver.is_active.is_(True))
        return q.order_by(Driver.name).all()

    def get_for_company(self, id: uuid.UUID, company_id: uuid.UUID, *, include_deleted: bool = False) -> Driver | None:  # type: ignore[override]
        return self.db.query(Driver).filter(Driver.id == id, Driver.company_id == company_id).first()


class TruckRepository(BaseRepository[Truck]):
    model = Truck

    def list_for_company(self, company_id: uuid.UUID, *, include_inactive: bool = False) -> Sequence[Truck]:
        q = self.db.query(Truck).filter(Truck.company_id == company_id)
        if not include_inactive:
            q = q.filter(Truck.is_active.is_(True))
        return q.order_by(Truck.plate_number).all()

    def get_for_company(self, id: uuid.UUID, company_id: uuid.UUID, *, include_deleted: bool = False) -> Truck | None:  # type: ignore[override]
        return self.db.query(Truck).filter(Truck.id == id, Truck.company_id == company_id).first()


class TripRepository(BaseRepository[DispatchTrip]):
    model = DispatchTrip

    def list_for_company(self, company_id: uuid.UUID, *, limit: int = 100) -> Sequence[DispatchTrip]:
        return (
            self.db.query(DispatchTrip)
            .filter(DispatchTrip.company_id == company_id)
            .order_by(DispatchTrip.dispatch_date.desc(), DispatchTrip.created_at.desc())
            .limit(limit)
            .all()
        )

    def get_for_company(
        self, id: uuid.UUID, company_id: uuid.UUID, *, include_deleted: bool = False
    ) -> DispatchTrip | None:  # type: ignore[override]
        return self.db.query(DispatchTrip).filter(DispatchTrip.id == id, DispatchTrip.company_id == company_id).first()

    def next_trip_no(self) -> str:
        # trip_no is globally unique, so the counter must be global too —
        # a per-company counter would collide across tenants on DT-00001.
        count = self.db.query(DispatchTrip).count()
        return f"DT-{count + 1:05d}"
