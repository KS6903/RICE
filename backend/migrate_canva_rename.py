"""One-time migration: rename every "canvas" identifier in the existing DB to "canva".

Project-wide rename — the application code now refers to:
  - column `canva_color_hex` on customers / suppliers / agents / millers
  - feature flag string `canva_inventory` in subscription_plans.features
Existing databases still hold the legacy "canvas_*" names; this script bridges
the gap. Idempotent: safe to re-run.

Run once: `python migrate_canva_rename.py`
"""
import os

from sqlalchemy import text

os.environ["PROCESS_ROLE"] = "provisioner"

COLUMN_RENAMES = [
    "ALTER TABLE customers RENAME COLUMN canvas_color_hex TO canva_color_hex",
    "ALTER TABLE suppliers RENAME COLUMN canvas_color_hex TO canva_color_hex",
    "ALTER TABLE agents    RENAME COLUMN canvas_color_hex TO canva_color_hex",
    "ALTER TABLE millers   RENAME COLUMN canvas_color_hex TO canva_color_hex",
]

# Drop the old partial unique indexes (they reference canvas_color_hex) and
# rebuild them against canva_color_hex.
INDEX_DROPS = [
    "DROP INDEX IF EXISTS ux_customers_company_color",
    "DROP INDEX IF EXISTS ux_suppliers_company_color",
    "DROP INDEX IF EXISTS ux_agents_company_color",
    "DROP INDEX IF EXISTS ux_millers_company_color",
]
INDEX_CREATES = [
    """CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_company_color
       ON customers(company_id, canva_color_hex) WHERE canva_color_hex IS NOT NULL""",
    """CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_company_color
       ON suppliers(company_id, canva_color_hex) WHERE canva_color_hex IS NOT NULL""",
    """CREATE UNIQUE INDEX IF NOT EXISTS ux_agents_company_color
       ON agents(company_id, canva_color_hex) WHERE canva_color_hex IS NOT NULL""",
    """CREATE UNIQUE INDEX IF NOT EXISTS ux_millers_company_color
       ON millers(company_id, canva_color_hex) WHERE canva_color_hex IS NOT NULL""",
]

# Feature flag rename inside JSONB arrays. subscription_plans.features and
# subscriptions.feature_overrides (if any tenant carries overrides) both store
# feature codes as JSON string lists.
FEATURE_FLAG_UPDATES = [
    # Plans: replace "canvas_inventory" with "canva_inventory" everywhere it appears.
    """UPDATE subscription_plans
       SET features = (
           SELECT jsonb_agg(CASE WHEN elem = '"canvas_inventory"'::jsonb
                                 THEN '"canva_inventory"'::jsonb
                                 ELSE elem END)
           FROM jsonb_array_elements(features) AS elem
       )
       WHERE features @> '["canvas_inventory"]'::jsonb""",
]


def _column_exists(conn, table: str, column: str) -> bool:
    row = conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c"
        ),
        {"t": table, "c": column},
    ).first()
    return row is not None


def main():
    from app.core.database import provisioner_engine

    with provisioner_engine.connect() as conn:
        # Column renames — only fire when the OLD column still exists.
        for stmt in COLUMN_RENAMES:
            parts = stmt.split()
            table = parts[2]
            if _column_exists(conn, table, "canvas_color_hex"):
                conn.execute(text(stmt))
                print(f"  renamed {table}.canvas_color_hex -> canva_color_hex")
            else:
                print(f"  skip {table} (canvas_color_hex already gone)")

        for stmt in INDEX_DROPS:
            conn.execute(text(stmt))
        for stmt in INDEX_CREATES:
            conn.execute(text(stmt))
        print("  rebuilt partial unique indexes against canva_color_hex")

        for stmt in FEATURE_FLAG_UPDATES:
            res = conn.execute(text(stmt))
            print(f"  feature flag update touched {res.rowcount} rows")

        conn.commit()
    print("Migration complete: canvas -> canva rename applied to existing data.")


if __name__ == "__main__":
    main()
