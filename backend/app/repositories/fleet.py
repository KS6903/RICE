"""Repositories for the fleet domain."""

import uuid
from typing import Sequence

from sqlalchemy import Integer, cast, func

from ..models.fleet import DispatchTrip, Driver, Truck
from ..services.doc_numbers import trip_pattern
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

    def next_trip_no(self, code: str) -> str:
        """RM1-T0001, RM1-T0002, ...: the mill's code, then one more than its
        highest trip number so far, so a number is never handed out twice."""
        top = (
            self.db.query(func.max(cast(func.substr(DispatchTrip.trip_no, len(code) + 3), Integer)))
            .filter(DispatchTrip.trip_no.op("~")(trip_pattern(code)))
            .scalar()
        )
        return f"{code}-T{int(top or 0) + 1:04d}"

    def trip_no_taken(self, trip_no: str, *, except_id: uuid.UUID | None = None) -> bool:
        q = self.db.query(DispatchTrip.id).filter(DispatchTrip.trip_no == trip_no)
        if except_id is not None:
            q = q.filter(DispatchTrip.id != except_id)
        return q.first() is not None
