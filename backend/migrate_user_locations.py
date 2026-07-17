"""One-time migration: add user_locations table for the saved-favorites feature.

Idempotent. Run once: `python migrate_user_locations.py`
"""
import os

from sqlalchemy import text

os.environ["PROCESS_ROLE"] = "provisioner"

CREATE = """
CREATE TABLE IF NOT EXISTS user_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(120) NOT NULL,
    lat NUMERIC(8,4) NOT NULL,
    lon NUMERIC(8,4) NOT NULL,
    country VARCHAR(80),
    region VARCHAR(120),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_user_locations_user_label UNIQUE (user_id, label)
)
"""

INDEX_DEFAULT = """
CREATE INDEX IF NOT EXISTS ix_user_locations_user_default
ON user_locations(user_id) WHERE is_default
"""


def main():
    from app.core.database import provisioner_engine

    with provisioner_engine.connect() as conn:
        conn.execute(text(CREATE))
        conn.execute(text(INDEX_DEFAULT))
        conn.commit()
    print("Migration complete: user_locations table ready.")


if __name__ == "__main__":
    main()
