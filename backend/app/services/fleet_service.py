"""FleetService — trucks, drivers, and dispatch trips."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import NotFoundError
from ..models.fleet import DispatchTrip, Driver, Truck
from ..repositories.fleet import DriverRepository, TripRepository, TruckRepository
from .base import BaseService


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
            "fuel_consumption_l_per_100km": float(t.fuel_consumption_l_per_100km) if t.fuel_consumption_l_per_100km is not None else None,
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
            trip_no=self.trips.next_trip_no(),
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
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(trip, field, val)
        self.db.refresh(trip)
        return self._ser_trip(trip)
