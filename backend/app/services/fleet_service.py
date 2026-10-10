"""FleetService — trucks, drivers, and dispatch trips."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import ConflictError, NotFoundError, PermissionDeniedError
from ..models.fleet import DispatchTrip, Driver, Truck
from ..repositories.fleet import DriverRepository, TripRepository, TruckRepository
from .base import BaseService
from .delivery_rules import (
    TRIP_LOCKING,
    check_can_unmark_trip,
    check_trip_editable,
    is_owner,
    trip_edit_deadline,
)
from .doc_numbers import mill_code


class FleetService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        drivers: DriverRepository,
        trucks: TruckRepository,
        trips: TripRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.drivers = drivers
        self.trucks = trucks
        self.trips = trips

    # ── serializers ──────────────────────────────────────────────────────────

    @staticmethod
    def _ser_driver(d: Driver) -> dict:
        return {
            "id": str(d.id),
            "name": d.name,
            "phone": d.phone,
            "license_no": d.license_no,
            "is_payroll": d.is_payroll,
            "employee_id": str(d.employee_id) if d.employee_id else None,
            "employee_name": d.employee.full_name if d.employee else None,  # type: ignore[attr-defined]
            "is_active": d.is_active,
        }

    @staticmethod
    def _ser_truck(t: Truck) -> dict:
        return {
            "id": str(t.id),
            "plate_number": t.plate_number,
            "truck_type": t.truck_type,
            "fuel_consumption_l_per_100km": float(t.fuel_consumption_l_per_100km)
            if t.fuel_consumption_l_per_100km is not None
            else None,
            "default_driver_id": str(t.default_driver_id) if t.default_driver_id else None,
            "default_driver_name": t.default_driver.name if t.default_driver else None,
            "notes": t.notes,
            "is_active": t.is_active,
        }

    @staticmethod
    def _ser_trip(trip: DispatchTrip) -> dict:
        return {
            "id": str(trip.id),
            "trip_no": trip.trip_no,
            "truck_id": str(trip.truck_id),
            "truck_plate": trip.truck.plate_number if trip.truck else None,
            "truck_type": trip.truck.truck_type if trip.truck else None,
            "driver_id": str(trip.driver_id),
            "driver_name": trip.driver.name if trip.driver else None,
            "order_id": str(trip.order_id) if trip.order_id else None,
            "order_no": trip.order.order_no if trip.order else None,
            "dispatch_date": trip.dispatch_date.isoformat() if trip.dispatch_date else None,
            "fuel_used_l": float(trip.fuel_used_l) if trip.fuel_used_l is not None else None,
            "destination": trip.destination,
            "notes": trip.notes,
            "status": trip.status,
            "status_changed_at": trip.status_changed_at.isoformat() if trip.status_changed_at else None,
            # Until when a departed or delivered trip can still be edited (null for
            # a trip that has not left yet).
            "edit_until": deadline.isoformat() if (deadline := trip_edit_deadline(trip)) else None,
            "created_by": str(trip.created_by) if trip.created_by else None,
        }

    # ── drivers ───────────────────────────────────────────────────────────────

    def list_drivers(self, *, include_inactive: bool = False) -> list[dict]:
        rows = self.drivers.list_for_company(self.current_user.company_id, include_inactive=include_inactive)
        return [self._ser_driver(d) for d in rows]

    def create_driver(self, data: Any) -> dict:
        driver = Driver(
            company_id=self.current_user.company_id,
            branch_id=self.current_user.branch_id,
            **data.model_dump(),
        )
        with self.transaction():
            self.drivers.add(driver)
        self.db.refresh(driver)
        return self._ser_driver(driver)

    def update_driver(self, driver_id: uuid.UUID, data: Any) -> dict:
        d = self.drivers.get_for_company(id=driver_id, company_id=self.current_user.company_id)
        if not d:
            raise NotFoundError("Driver not found")
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(d, field, val)
        self.db.refresh(d)
        return self._ser_driver(d)

    # ── trucks ────────────────────────────────────────────────────────────────

    def list_trucks(self, *, include_inactive: bool = False) -> list[dict]:
        rows = self.trucks.list_for_company(self.current_user.company_id, include_inactive=include_inactive)
        return [self._ser_truck(t) for t in rows]

    def create_truck(self, data: Any) -> dict:
        truck = Truck(
            company_id=self.current_user.company_id,
            branch_id=self.current_user.branch_id,
            **data.model_dump(),
        )
        with self.transaction():
            self.trucks.add(truck)
        self.db.refresh(truck)
        return self._ser_truck(truck)

    def update_truck(self, truck_id: uuid.UUID, data: Any) -> dict:
        t = self.trucks.get_for_company(id=truck_id, company_id=self.current_user.company_id)
        if not t:
            raise NotFoundError("Truck not found")
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(t, field, val)
        self.db.refresh(t)
        return self._ser_truck(t)

    # ── trips ─────────────────────────────────────────────────────────────────

    def list_trips(self, *, limit: int = 100) -> list[dict]:
        rows = self.trips.list_for_company(self.current_user.company_id, limit=limit)
        return [self._ser_trip(r) for r in rows]

    def create_trip(self, data: Any) -> dict:
        truck = self.trucks.get_for_company(data.truck_id, self.current_user.company_id)
        if not truck:
            raise NotFoundError("Truck not found")
        driver = self.drivers.get_for_company(data.driver_id, self.current_user.company_id)
        if not driver:
            raise NotFoundError("Driver not found")
        trip = DispatchTrip(
            company_id=self.current_user.company_id,
            branch_id=self.current_user.branch_id,
            trip_no=self.trips.next_trip_no(
                mill_code(self.current_user.company.name if self.current_user.company else None)
            ),
            created_by=self.current_user.id,
            **data.model_dump(),
        )
        with self.transaction():
            self.trips.add(trip)
        self.db.refresh(trip)
        return self._ser_trip(trip)

    def update_trip(self, trip_id: uuid.UUID, data: Any) -> dict:
        trip = self.trips.get_for_company(id=trip_id, company_id=self.current_user.company_id)
        if not trip:
            raise NotFoundError("Trip not found")
        changes = data.model_dump(exclude_none=True)

        # Once it has left or arrived, a trip can be edited for a week, then it locks.
        check_trip_editable(trip)

        # Moving a trip back from departed or delivered is the owner's call (going
        # on from departed to delivered is not "back").
        new_status = changes.get("status")
        going_back = (
            trip.status in TRIP_LOCKING
            and new_status is not None
            and new_status != trip.status
            and not (trip.status == "in_transit" and new_status == "completed")
        )
        if going_back:
            check_can_unmark_trip(trip, self.current_user)

        # So is renumbering.
        new_no = changes.pop("trip_no", None)
        if new_no is not None:
            new_no = new_no.strip()
            if not is_owner(self.current_user):
                raise PermissionDeniedError("Only the owner can change a trip number.")
            if not new_no:
                raise ConflictError("A trip needs a number.")
            if new_no != trip.trip_no and self.trips.trip_no_taken(new_no, except_id=trip.id):
                raise ConflictError(f"{new_no} is already used by another trip.")

        status_changed = new_status is not None and new_status != trip.status
        with self.transaction():
            for field, val in changes.items():
                setattr(trip, field, val)
            if new_no is not None:
                trip.trip_no = new_no
            if status_changed:
                trip.status_changed_at = datetime.now(timezone.utc)
        self.db.refresh(trip)
        return self._ser_trip(trip)
