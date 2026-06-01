"""Spatial warehouse canva: layouts, zones, pallets, rice batches, movements.

Revision ID: 011_warehouse_canva
Revises: 010_plan_change_queue
Create Date: 2026-05-28

Phase 1 of the Enterprise Visual Canva Inventory System. Adds the spatial
layer alongside the existing milled_rice_inventory/palay_inventory tables.

Tables:
  - warehouse_layouts:  one per branch (optional). Floor dimensions in meters.
  - warehouse_zones:    functional areas inside a layout (intake, storage, dock).
  - pallets:            physical units placed at (x_m, y_m) on a layout.
  - rice_batches:       contents of each pallet — variety, moisture, milling date.
  - pallet_movements:   audit log of every drag/stack/dispatch.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "011_warehouse_canva"
down_revision = "010_plan_change_queue"
branch_labels = None
depends_on = None


def upgrade():
    # ── warehouse_layouts ──────────────────────────────────────────────────────
    op.create_table(
        "warehouse_layouts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("branch_id", UUID(as_uuid=True), sa.ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("width_m", sa.Numeric(8, 2), nullable=False, server_default="30"),
        sa.Column("height_m", sa.Numeric(8, 2), nullable=False, server_default="20"),
        sa.Column("grid_size_m", sa.Numeric(4, 2), nullable=False, server_default="0.5"),
        sa.Column("background_url", sa.Text, nullable=True),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("idx_layouts_company", "warehouse_layouts", ["company_id"])

    # ── warehouse_zones ────────────────────────────────────────────────────────
    op.create_table(
        "warehouse_zones",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("layout_id", UUID(as_uuid=True), sa.ForeignKey("warehouse_layouts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("zone_type", sa.String(40), nullable=False),  # paddy_intake|drying|milling|premium_storage|shipping_dock|office|aisle|general
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("x_m", sa.Numeric(8, 2), nullable=False),
        sa.Column("y_m", sa.Numeric(8, 2), nullable=False),
        sa.Column("width_m", sa.Numeric(8, 2), nullable=False),
        sa.Column("height_m", sa.Numeric(8, 2), nullable=False),
        sa.Column("rotation_deg", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("max_weight_kg", sa.Numeric(12, 2), nullable=True),
        sa.Column("target_humidity_pct", sa.Numeric(4, 2), nullable=True),
        sa.Column("target_temp_c", sa.Numeric(4, 1), nullable=True),
        sa.Column("color_hex", sa.String(7), nullable=False, server_default="#94a3b8"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("idx_zones_layout", "warehouse_zones", ["layout_id"])

    # ── pallets ────────────────────────────────────────────────────────────────
    op.create_table(
        "pallets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("layout_id", UUID(as_uuid=True), sa.ForeignKey("warehouse_layouts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("zone_id", UUID(as_uuid=True), sa.ForeignKey("warehouse_zones.id", ondelete="SET NULL"), nullable=True),
        sa.Column("pallet_code", sa.String(40), nullable=False, unique=True),
        sa.Column("x_m", sa.Numeric(8, 2), nullable=False),
        sa.Column("y_m", sa.Numeric(8, 2), nullable=False),
        sa.Column("z_layer", sa.SmallInteger, nullable=False, server_default="0"),
        sa.Column("stack_parent_id", UUID(as_uuid=True), sa.ForeignKey("pallets.id"), nullable=True),
        sa.Column("width_m", sa.Numeric(4, 2), nullable=False, server_default="1.2"),
        sa.Column("depth_m", sa.Numeric(4, 2), nullable=False, server_default="0.8"),
        sa.Column("sack_count", sa.Integer, nullable=False),
        sa.Column("weight_kg", sa.Numeric(10, 2), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="in_storage"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("idx_pallets_layout", "pallets", ["layout_id"])
    op.create_index("idx_pallets_zone", "pallets", ["zone_id"])
    op.create_index("idx_pallets_company", "pallets", ["company_id"])
    op.create_index("idx_pallets_stack", "pallets", ["stack_parent_id"])

    # ── rice_batches ───────────────────────────────────────────────────────────
    op.create_table(
        "rice_batches",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pallet_id", UUID(as_uuid=True), sa.ForeignKey("pallets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("milling_batch_id", UUID(as_uuid=True), sa.ForeignKey("milling_batches.id"), nullable=True),
        sa.Column("variety_id", UUID(as_uuid=True), sa.ForeignKey("rice_varieties.id"), nullable=True),
        sa.Column("grade_id", UUID(as_uuid=True), sa.ForeignKey("quality_grades.id"), nullable=True),
        sa.Column("client_id", UUID(as_uuid=True), nullable=True),
        sa.Column("client_type", sa.String(20), nullable=True),  # supplier|customer|mill_own
        sa.Column("client_name", sa.String(150), nullable=True),  # denormalized for display
        sa.Column("sack_count", sa.Integer, nullable=False),
        sa.Column("weight_kg", sa.Numeric(10, 2), nullable=False),
        sa.Column("moisture_pct", sa.Numeric(4, 2), nullable=True),
        sa.Column("milling_date", sa.Date, nullable=False),
        sa.Column("best_before_date", sa.Date, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="fresh"),  # fresh|warning|critical|expired
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("idx_batches_pallet", "rice_batches", ["pallet_id"])
    op.create_index("idx_batches_company", "rice_batches", ["company_id"])

    # ── pallet_movements ───────────────────────────────────────────────────────
    op.create_table(
        "pallet_movements",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("pallet_id", UUID(as_uuid=True), sa.ForeignKey("pallets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("movement_type", sa.String(20), nullable=False),  # create|move|stack|unstack|dispatch
        sa.Column("from_zone_id", UUID(as_uuid=True), nullable=True),
        sa.Column("to_zone_id", UUID(as_uuid=True), nullable=True),
        sa.Column("from_x_m", sa.Numeric(8, 2), nullable=True),
        sa.Column("from_y_m", sa.Numeric(8, 2), nullable=True),
        sa.Column("to_x_m", sa.Numeric(8, 2), nullable=True),
        sa.Column("to_y_m", sa.Numeric(8, 2), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("idx_movements_pallet", "pallet_movements", ["pallet_id"])

    # Canva color on suppliers/customers
    op.add_column("suppliers", sa.Column("canva_color_hex", sa.String(7), nullable=True))
    op.add_column("customers", sa.Column("canva_color_hex", sa.String(7), nullable=True))


def downgrade():
    op.drop_column("customers", "canva_color_hex")
    op.drop_column("suppliers", "canva_color_hex")
    op.drop_index("idx_movements_pallet", "pallet_movements")
    op.drop_table("pallet_movements")
    op.drop_index("idx_batches_company", "rice_batches")
    op.drop_index("idx_batches_pallet", "rice_batches")
    op.drop_table("rice_batches")
    op.drop_index("idx_pallets_stack", "pallets")
    op.drop_index("idx_pallets_company", "pallets")
    op.drop_index("idx_pallets_zone", "pallets")
    op.drop_index("idx_pallets_layout", "pallets")
    op.drop_table("pallets")
    op.drop_index("idx_zones_layout", "warehouse_zones")
    op.drop_table("warehouse_zones")
    op.drop_index("idx_layouts_company", "warehouse_layouts")
    op.drop_table("warehouse_layouts")
