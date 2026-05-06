"""initial schema

Revision ID: 001_initial_schema
Revises:
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.create_table(
        "companies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("address", sa.Text),
        sa.Column("tin", sa.String(20)),
        sa.Column("nfa_license_no", sa.String(50)),
        sa.Column("da_registration_no", sa.String(50)),
        sa.Column("phone", sa.String(20)),
        sa.Column("email", sa.String(100)),
        sa.Column("logo_url", sa.Text),
        sa.Column("currency", sa.String(3), server_default="PHP"),
        sa.Column("timezone", sa.String(50), server_default="Asia/Manila"),
        sa.Column("is_multi_branch", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "branches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE")),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("address", sa.Text),
        sa.Column("is_main_branch", sa.Boolean, server_default="false"),
        sa.Column("is_active", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "roles",
        sa.Column("id", sa.SmallInteger, primary_key=True),
        sa.Column("name", sa.String(50), unique=True, nullable=False),
    )

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("username", sa.String(50), unique=True, nullable=False),
        sa.Column("email", sa.String(100), unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(150), nullable=False),
        sa.Column("role_id", sa.SmallInteger, sa.ForeignKey("roles.id")),
        sa.Column("is_active", sa.Boolean, server_default="true"),
        sa.Column("last_login", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "rice_varieties",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("category", sa.String(20)),
        sa.Column("typical_recovery_pct", sa.Numeric(5, 2)),
        sa.Column("is_active", sa.Boolean, server_default="true"),
    )

    op.create_table(
        "quality_grades",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("code", sa.String(10), nullable=False),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("min_moisture_pct", sa.Numeric(5, 2)),
        sa.Column("max_moisture_pct", sa.Numeric(5, 2)),
        sa.Column("description", sa.Text),
    )

    op.create_table(
        "byproduct_types",
        sa.Column("id", sa.SmallInteger, primary_key=True),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("local_name", sa.String(50)),
    )

    op.create_table(
        "suppliers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("supplier_type", sa.String(20)),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("contact_person", sa.String(150)),
        sa.Column("phone", sa.String(20)),
        sa.Column("address", sa.Text),
        sa.Column("municipality", sa.String(100)),
        sa.Column("province", sa.String(100)),
        sa.Column("farmer_id", sa.String(50)),
        sa.Column("is_active", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "customers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("customer_type", sa.String(30)),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("contact_person", sa.String(150)),
        sa.Column("phone", sa.String(20)),
        sa.Column("address", sa.Text),
        sa.Column("tin", sa.String(20)),
        sa.Column("credit_limit", sa.Numeric(14, 2), server_default="0"),
        sa.Column("payment_terms_days", sa.Integer, server_default="0"),
        sa.Column("is_p20_accredited", sa.Boolean, server_default="false"),
        sa.Column("is_active", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "palay_purchases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("reference_no", sa.String(30), unique=True, nullable=False),
        sa.Column("supplier_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("suppliers.id")),
        sa.Column("purchase_date", sa.Date, nullable=False),
        sa.Column("delivery_type", sa.String(20)),
        sa.Column("status", sa.String(20), server_default="draft"),
        sa.Column("remarks", sa.Text),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "palay_purchase_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("purchase_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("palay_purchases.id", ondelete="CASCADE")),
        sa.Column("variety_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("rice_varieties.id")),
        sa.Column("grade_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("quality_grades.id")),
        sa.Column("gross_weight_kg", sa.Numeric(10, 3), nullable=False),
        sa.Column("tare_weight_kg", sa.Numeric(10, 3), server_default="0"),
        sa.Column("cavan_count", sa.Numeric(8, 2)),
        sa.Column("moisture_content_pct", sa.Numeric(5, 2)),
        sa.Column("price_per_cavan", sa.Numeric(10, 2), nullable=False),
    )

    op.create_table(
        "drying_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("purchase_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("palay_purchase_items.id")),
        sa.Column("start_datetime", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_datetime", sa.DateTime(timezone=True)),
        sa.Column("initial_moisture_pct", sa.Numeric(5, 2)),
        sa.Column("final_moisture_pct", sa.Numeric(5, 2)),
        sa.Column("drying_method", sa.String(20)),
        sa.Column("drying_cost", sa.Numeric(10, 2), server_default="0"),
        sa.Column("operator_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
    )

    op.create_table(
        "palay_inventory",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("variety_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("rice_varieties.id")),
        sa.Column("grade_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("quality_grades.id")),
        sa.Column("quantity_kg", sa.Numeric(12, 3), server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("branch_id", "variety_id", "grade_id", name="uq_palay_inv_branch_variety_grade"),
    )

    op.create_table(
        "palay_inventory_movements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("inventory_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("palay_inventory.id")),
        sa.Column("movement_type", sa.String(20), nullable=False),
        sa.Column("source_type", sa.String(30)),
        sa.Column("source_id", postgresql.UUID(as_uuid=True)),
        sa.Column("quantity_kg", sa.Numeric(12, 3), nullable=False),
        sa.Column("balance_after_kg", sa.Numeric(12, 3)),
        sa.Column("notes", sa.Text),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "milling_equipment",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("model", sa.String(100)),
        sa.Column("capacity_kg_per_hr", sa.Numeric(8, 2)),
        sa.Column("is_active", sa.Boolean, server_default="true"),
    )

    op.create_table(
        "milling_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("batch_no", sa.String(30), unique=True, nullable=False),
        sa.Column("equipment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("milling_equipment.id")),
        sa.Column("operator_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("start_datetime", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_datetime", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(20), server_default="in_progress"),
        sa.Column("remarks", sa.Text),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "milling_batch_inputs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("milling_batches.id", ondelete="CASCADE")),
        sa.Column("variety_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("rice_varieties.id")),
        sa.Column("grade_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("quality_grades.id")),
        sa.Column("input_weight_kg", sa.Numeric(10, 3), nullable=False),
        sa.Column("moisture_content_pct", sa.Numeric(5, 2)),
    )

    op.create_table(
        "milling_batch_outputs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("milling_batches.id", ondelete="CASCADE")),
        sa.Column("output_type", sa.String(20), nullable=False),
        sa.Column("variety_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("rice_varieties.id")),
        sa.Column("output_weight_kg", sa.Numeric(10, 3), nullable=False),
        sa.Column("broken_rice_pct", sa.Numeric(5, 2)),
        sa.Column("milling_recovery_pct", sa.Numeric(5, 2)),
    )

    op.create_table(
        "milled_rice_inventory",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("variety_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("rice_varieties.id")),
        sa.Column("grade_name", sa.String(30)),
        sa.Column("quantity_kg", sa.Numeric(12, 3), server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("branch_id", "variety_id", "grade_name", name="uq_milled_inv_branch_variety_grade"),
    )

    op.create_table(
        "byproduct_inventory",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("byproduct_type", sa.String(20), nullable=False),
        sa.Column("quantity_kg", sa.Numeric(12, 3), server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("branch_id", "byproduct_type", name="uq_byproduct_inv_branch_type"),
    )

    op.create_table(
        "price_lists",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("variety_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("rice_varieties.id")),
        sa.Column("grade_name", sa.String(30)),
        sa.Column("customer_type", sa.String(30)),
        sa.Column("price_per_kg", sa.Numeric(10, 4)),
        sa.Column("price_per_cavan", sa.Numeric(10, 2)),
        sa.Column("price_per_sack_50kg", sa.Numeric(10, 2)),
        sa.Column("effective_date", sa.Date, nullable=False),
        sa.Column("expiry_date", sa.Date),
        sa.Column("is_active", sa.Boolean, server_default="true"),
    )

    op.create_table(
        "sales_orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("order_no", sa.String(30), unique=True, nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customers.id")),
        sa.Column("order_date", sa.Date, nullable=False),
        sa.Column("delivery_date", sa.Date),
        sa.Column("status", sa.String(20), server_default="draft"),
        sa.Column("is_p20_sale", sa.Boolean, server_default="false"),
        sa.Column("discount_pct", sa.Numeric(5, 2), server_default="0"),
        sa.Column("discount_amount", sa.Numeric(14, 2), server_default="0"),
        sa.Column("subtotal", sa.Numeric(14, 2)),
        sa.Column("total_amount", sa.Numeric(14, 2)),
        sa.Column("remarks", sa.Text),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "sales_order_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sales_orders.id", ondelete="CASCADE")),
        sa.Column("item_type", sa.String(20), nullable=False),
        sa.Column("variety_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("rice_varieties.id")),
        sa.Column("grade_name", sa.String(30)),
        sa.Column("byproduct_type", sa.String(20)),
        sa.Column("quantity_kg", sa.Numeric(10, 3), nullable=False),
        sa.Column("unit_price_per_kg", sa.Numeric(10, 4), nullable=False),
    )

    op.create_table(
        "invoices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("invoice_no", sa.String(30), unique=True, nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sales_orders.id")),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customers.id")),
        sa.Column("invoice_date", sa.Date, nullable=False),
        sa.Column("due_date", sa.Date),
        sa.Column("total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("paid_amount", sa.Numeric(14, 2), server_default="0"),
        sa.Column("status", sa.String(20), server_default="unpaid"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("invoices.id")),
        sa.Column("payment_date", sa.Date, nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("method", sa.String(20), nullable=False),
        sa.Column("reference_no", sa.String(50)),
        sa.Column("received_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "expense_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("is_production_cost", sa.Boolean, server_default="true"),
    )

    op.create_table(
        "expenses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("expense_categories.id")),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("milling_batches.id")),
        sa.Column("expense_date", sa.Date, nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("reference_no", sa.String(50)),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "compliance_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id")),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("report_type", sa.String(30), nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("generated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("file_url", sa.Text),
        sa.Column("status", sa.String(20), server_default="draft"),
    )

    op.create_table(
        "sync_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("table_name", sa.String(60), nullable=False),
        sa.Column("record_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("operation", sa.String(10), nullable=False),
        sa.Column("payload", postgresql.JSONB),
        sa.Column("client_id", sa.String(100)),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("is_conflict", sa.Boolean, server_default="false"),
    )

    op.create_table(
        "sync_conflicts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("table_name", sa.String(60), nullable=False),
        sa.Column("record_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("local_payload", postgresql.JSONB),
        sa.Column("remote_payload", postgresql.JSONB),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("resolution", sa.String(20)),
    )

    # Indexes for performance
    op.create_index("ix_palay_purchases_company_date", "palay_purchases", ["company_id", "purchase_date"])
    op.create_index("ix_milling_batches_company_date", "milling_batches", ["company_id", "start_datetime"])
    op.create_index("ix_sales_orders_company_date", "sales_orders", ["company_id", "order_date"])
    op.create_index("ix_expenses_company_date", "expenses", ["company_id", "expense_date"])
    op.create_index("ix_sync_log_synced_at", "sync_log", ["synced_at"])


def downgrade() -> None:
    for table in [
        "sync_conflicts", "sync_log", "compliance_reports",
        "expenses", "expense_categories", "payments", "invoices",
        "sales_order_items", "sales_orders", "price_lists",
        "byproduct_inventory", "milled_rice_inventory",
        "milling_batch_outputs", "milling_batch_inputs", "milling_batches", "milling_equipment",
        "palay_inventory_movements", "palay_inventory", "drying_records",
        "palay_purchase_items", "palay_purchases",
        "customers", "suppliers", "byproduct_types", "quality_grades", "rice_varieties",
        "users", "roles", "branches", "companies",
    ]:
        op.drop_table(table)
