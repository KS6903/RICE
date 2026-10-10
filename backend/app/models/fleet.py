"""Fleet models — trucks, drivers, and dispatch trips."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin

if TYPE_CHECKING:
    from .employee import Employee
    from .sales import SalesOrder
    from .user import User


class Driver(Base, TimestampMixin):
    __tablename__ = "drivers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), index=True)
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    license_no: Mapped[str | None] = mapped_column(String(50))
    is_payroll: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    employee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    employee: Mapped["Employee | None"] = relationship("Employee", foreign_keys=[employee_id])


class Truck(Base, TimestampMixin):
    __tablename__ = "trucks"

    TRUCK_TYPES = ["forward", "canter", "closed_van", "drop_side", "boom_truck", "reefer", "tanker", "pickup", "other"]

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), index=True)
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    plate_number: Mapped[str] = mapped_column(String(20), nullable=False)
    truck_type: Mapped[str | None] = mapped_column(String(50))
    fuel_consumption_l_per_100km: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    default_driver_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    default_driver: Mapped["Driver | None"] = relationship("Driver", foreign_keys=[default_driver_id])


class DispatchTrip(Base, TimestampMixin):
    __tablename__ = "dispatch_trips"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    trip_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    truck_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trucks.id"), nullable=False)
    driver_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False)
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True
    )
    dispatch_date: Mapped[date] = mapped_column(Date, nullable=False)
    fuel_used_l: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    destination: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)
    # When the status last changed. A departed or delivered trip stays editable
    # for a week from here, then locks.
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    truck: Mapped["Truck"] = relationship("Truck", foreign_keys=[truck_id])
    driver: Mapped["Driver"] = relationship("Driver", foreign_keys=[driver_id])
    order: Mapped["SalesOrder | None"] = relationship("SalesOrder", foreign_keys=[order_id])
    creator: Mapped["User | None"] = relationship("User", foreign_keys=[created_by])
