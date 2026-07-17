import os

from sqlalchemy import text

os.environ["PROCESS_ROLE"] = "provisioner"

from app.core.database import provisioner_engine

with provisioner_engine.begin() as c:
    c.execute(text("ALTER TABLE warehouse_layouts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"))
    c.execute(text("ALTER TABLE warehouse_layouts ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL"))
    c.execute(text("UPDATE alembic_version SET version_num = '013_layout_trash'"))
print("migration 013 applied")
