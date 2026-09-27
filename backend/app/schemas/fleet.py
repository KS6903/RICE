"""Pydantic schemas for the fleet domain (trucks, drivers, dispatch trips)."""
import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel

# ── Drivers ──────────────────────────────────────────────────────────────────

class DriverCreate(BaseModel):
    name: str
    phone: str | None = None
    license_no: str | None = None
    is_payroll: bool = False
    employee_id: uuid.UUID | None = None


class DriverUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    license_no: str | None = None
    is_payroll: bool | None = None
    employee_id: uuid.UUID | None = None
    is_active: bool | None = None


# ── Trucks ───────────────────────────────────────────────────────────────────

class TruckCreate(BaseModel):
    plate_number: str
    truck_type: str | None = None
    fuel_consumption_l_per_100km: Decimal | None = None
    default_driver_id: uuid.UUID | None = None
    notes: str | None = None


class TruckUpdate(BaseModel):
    plate_number: str | None = None
    truck_type: str | None = None
    fuel_consumption_l_per_100km: Decimal | None = None
    default_driver_id: uuid.UUID | None = None
    notes: str | None = None
    is_active: bool | None = None


# ── Dispatch trips ────────────────────────────────────────────────────────────

class TripCreate(BaseModel):
    truck_id: uuid.UUID
    driver_id: uuid.UUID
    dispatch_date: date
    fuel_used_l: Decimal | None = None
    order_id: uuid.UUID | None = None
    destination: str | None = None
    notes: str | None = None


class TripUpdate(BaseModel):
    driver_id: uuid.UUID | None = None
    dispatch_date: date | None = None
    fuel_used_l: Decimal | None = None
    order_id: uuid.UUID | None = None
    destination: str | None = None
    notes: str | None = None
    status: str | None = None
