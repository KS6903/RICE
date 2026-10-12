import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin


class Employee(Base, TimestampMixin):
    __tablename__ = "employees"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    employee_no: Mapped[str | None] = mapped_column(String(30))
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    middle_name: Mapped[str | None] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)

    position: Mapped[str | None] = mapped_column(String(100))  # Mill Operator, Driver, Cashier, Laborer
    department: Mapped[str | None] = mapped_column(String(100))  # Operations, Office, Drying, Logistics
    employment_type: Mapped[str | None] = mapped_column(String(30))  # regular, contractual, casual, probationary
    date_hired: Mapped[date | None] = mapped_column(Date)
    date_terminated: Mapped[date | None] = mapped_column(Date)
    # What the employment type pays per day, week, hour... (the monthly figure
    # below is worked out from it). The column keeps its old name.
    daily_rate: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    monthly_salary: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))

    # How the salary is paid: cash, check, bank_transfer, e_wallet, payroll_card.
    # The three detail columns mean what the method needs: the bank, e-wallet
    # provider or card issuer; the account holder (or the check's payee); and the
    # account, mobile or card number.
    pay_method: Mapped[str | None] = mapped_column(String(20))
    pay_provider: Mapped[str | None] = mapped_column(String(100))
    pay_account_name: Mapped[str | None] = mapped_column(String(150))
    pay_account_no: Mapped[str | None] = mapped_column(String(40))

    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(100))
    address: Mapped[str | None] = mapped_column(Text)
    birthdate: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(10))  # male, female, other
    civil_status: Mapped[str | None] = mapped_column(String(20))  # single, married, widowed, separated

    sss_no: Mapped[str | None] = mapped_column(String(30))
    philhealth_no: Mapped[str | None] = mapped_column(String(30))
    pagibig_no: Mapped[str | None] = mapped_column(String(30))
    tin: Mapped[str | None] = mapped_column(String(30))

    emergency_contact_name: Mapped[str | None] = mapped_column(String(150))
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(20))
    emergency_contact_relation: Mapped[str | None] = mapped_column(String(50))

    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    branch = relationship("Branch", foreign_keys=[branch_id])
