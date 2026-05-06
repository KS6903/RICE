"""Create employees table.

Revision ID: 005_employees
Revises: 004_company_active
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "005_employees"
down_revision = "004_company_active"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "employees",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=True),
        sa.Column("branch_id", UUID(as_uuid=True), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),

        sa.Column("employee_no", sa.String(30), nullable=True),
        sa.Column("first_name", sa.String(100), nullable=False),
        sa.Column("middle_name", sa.String(100), nullable=True),
        sa.Column("last_name", sa.String(100), nullable=False),

        sa.Column("position", sa.String(100), nullable=True),
        sa.Column("department", sa.String(100), nullable=True),
        sa.Column("employment_type", sa.String(30), nullable=True),
        sa.Column("date_hired", sa.Date(), nullable=True),
        sa.Column("date_terminated", sa.Date(), nullable=True),
        sa.Column("daily_rate", sa.Numeric(10, 2), nullable=True),
        sa.Column("monthly_salary", sa.Numeric(12, 2), nullable=True),

        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("email", sa.String(100), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("birthdate", sa.Date(), nullable=True),
        sa.Column("gender", sa.String(10), nullable=True),
        sa.Column("civil_status", sa.String(20), nullable=True),

        sa.Column("sss_no", sa.String(30), nullable=True),
        sa.Column("philhealth_no", sa.String(30), nullable=True),
        sa.Column("pagibig_no", sa.String(30), nullable=True),
        sa.Column("tin", sa.String(30), nullable=True),

        sa.Column("emergency_contact_name", sa.String(150), nullable=True),
        sa.Column("emergency_contact_phone", sa.String(20), nullable=True),
        sa.Column("emergency_contact_relation", sa.String(50), nullable=True),

        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),

        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("ix_employees_company_id", "employees", ["company_id"])
    op.create_index("ix_employees_branch_id", "employees", ["branch_id"])


def downgrade() -> None:
    op.drop_index("ix_employees_branch_id", table_name="employees")
    op.drop_index("ix_employees_company_id", table_name="employees")
    op.drop_table("employees")
