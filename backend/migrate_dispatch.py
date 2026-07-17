"""One-time migration: introduce Dispatch tab (Agents, Millers, courier on SalesOrder).

Changes:
  1. Create `agents` and `millers` tables.
  2. Add `assigned_agent_id`, `assigned_miller_id`, `delivered_at` columns to `sales_orders`.
  3. Add partial unique indexes on `(company_id, canva_color_hex)` for customers,
     suppliers, agents, millers — per-tenant in-table color uniqueness. Cross-table
     uniqueness is handled at the application layer (services/canva_color.py).

Idempotent — safe to re-run. Apply with: `python migrate_dispatch.py`
"""
import os

from sqlalchemy import text

os.environ["PROCESS_ROLE"] = "provisioner"

CREATE_AGENTS = """
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    name VARCHAR(200) NOT NULL,
    agent_type VARCHAR(30),
    contact_person VARCHAR(150),
    phone VARCHAR(20),
    address TEXT,
    commission_pct NUMERIC(5,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    canva_color_hex VARCHAR(7),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""

CREATE_MILLERS = """
CREATE TABLE IF NOT EXISTS millers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(150),
    phone VARCHAR(20),
    address TEXT,
    capacity_kg_per_hr NUMERIC(10,2),
    milling_fee_per_kg NUMERIC(10,4),
    is_active BOOLEAN DEFAULT TRUE,
    canva_color_hex VARCHAR(7),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""

ALTER_SALES_ORDERS = [
    "ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES agents(id)",
    "ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS assigned_miller_id UUID REFERENCES millers(id)",
    "ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ",
]

PARTIAL_UNIQUE_INDEXES = [
    # In-table color uniqueness, scoped per-tenant. Cross-table uniqueness is
    # enforced by services/canva_color.py.
    """CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_company_color
       ON customers(company_id, canva_color_hex) WHERE canva_color_hex IS NOT NULL""",
    """CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_company_color
       ON suppliers(company_id, canva_color_hex) WHERE canva_color_hex IS NOT NULL""",
    """CREATE UNIQUE INDEX IF NOT EXISTS ux_agents_company_color
       ON agents(company_id, canva_color_hex) WHERE canva_color_hex IS NOT NULL""",
    """CREATE UNIQUE INDEX IF NOT EXISTS ux_millers_company_color
       ON millers(company_id, canva_color_hex) WHERE canva_color_hex IS NOT NULL""",
]


def main():
    from app.core.database import provisioner_engine

    with provisioner_engine.connect() as conn:
        conn.execute(text(CREATE_AGENTS))
        conn.execute(text(CREATE_MILLERS))
        for stmt in ALTER_SALES_ORDERS:
            conn.execute(text(stmt))
        for stmt in PARTIAL_UNIQUE_INDEXES:
            conn.execute(text(stmt))
        conn.commit()
    print("Migration complete: dispatch tables + courier columns + color uniqueness indexes.")


if __name__ == "__main__":
    main()
