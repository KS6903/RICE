"""017 — remove P20 rice program fields

Drops:
  - customers.is_p20_accredited
  - sales_orders.is_p20_sale
"""
from alembic import op

revision = "017_remove_p20_fields"
down_revision = "016_fleet_and_dispatch_trips"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("customers", "is_p20_accredited")
    op.drop_column("sales_orders", "is_p20_sale")


def downgrade() -> None:
    import sqlalchemy as sa
    op.add_column("sales_orders", sa.Column("is_p20_sale", sa.Boolean, nullable=False, server_default="false"))
    op.add_column("customers", sa.Column("is_p20_accredited", sa.Boolean, nullable=False, server_default="false"))
