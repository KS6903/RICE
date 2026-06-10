"""016 — trucks, drivers, dispatch_trips

Adds fleet management tables:
  - trucks: company-owned vehicles (plate, type, fuel rate, default driver)
  - drivers: delivery drivers, optionally linked to an employee (payroll flag)
  - dispatch_trips: a logged delivery run — truck + driver + fuel + optional order link
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "drivers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("phone", sa.String(20)),
        sa.Column("license_no", sa.String(50)),
        sa.Column("is_payroll", sa.Boolean, default=False, nullable=False, server_default="false"),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("employees.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_active", sa.Boolean, default=True, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_drivers_company", "drivers", ["company_id"])

    op.create_table(
        "trucks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("plate_number", sa.String(20), nullable=False),
        sa.Column("truck_type", sa.String(50)),   # forward, canter, closed_van, drop_side, boom_truck, reefer, tanker
        sa.Column("fuel_consumption_l_per_100km", sa.Numeric(6, 2), nullable=True),
        sa.Column("default_driver_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("drivers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, default=True, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_trucks_company", "trucks", ["company_id"])

    op.create_table(
        "dispatch_trips",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("trip_no", sa.String(30), nullable=False, unique=True),
        sa.Column("truck_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("trucks.id"), nullable=False),
        sa.Column("driver_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("drivers.id"), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("dispatch_date", sa.Date, nullable=False),
        sa.Column("fuel_used_l", sa.Numeric(8, 2), nullable=True),
        sa.Column("destination", sa.Text, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="planned"),  # planned, in_transit, completed, cancelled
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_dispatch_trips_company_date", "dispatch_trips", ["company_id", "dispatch_date"])


def downgrade() -> None:
    op.drop_table("dispatch_trips")
    op.drop_index("ix_trucks_company", "trucks")
    op.drop_table("trucks")
    op.drop_index("ix_drivers_company", "drivers")
    op.drop_table("drivers")
