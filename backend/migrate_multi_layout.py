"""
One-time migration: allow multiple layouts per branch.

Changes:
  1. Drops the unique constraint on warehouse_layouts.branch_id
  2. Adds is_default column (boolean, NOT NULL DEFAULT true)

Run once: python migrate_multi_layout.py
"""

import os

from sqlalchemy import text

os.environ["PROCESS_ROLE"] = "provisioner"


def main():
    from app.core.database import provisioner_engine

    with provisioner_engine.connect() as conn:
        conn.execute(text("ALTER TABLE warehouse_layouts " "DROP CONSTRAINT IF EXISTS warehouse_layouts_branch_id_key"))
        conn.execute(
            text("ALTER TABLE warehouse_layouts " "ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT true")
        )
        conn.commit()
    print("Migration complete: multi-layout support enabled.")


if __name__ == "__main__":
    main()
