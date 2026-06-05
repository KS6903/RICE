from sqlalchemy import create_engine, text
from app.core.config import settings
url = settings.DATABASE_URL.replace("postgresql://", "postgresql+psycopg://")
e = create_engine(url)
with e.begin() as c:
    c.execute(text("ALTER TABLE warehouse_layouts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"))
    c.execute(text("ALTER TABLE warehouse_layouts ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL"))
    c.execute(text("UPDATE alembic_version SET version_num = '013_layout_trash'"))
print("migration 013 applied")
