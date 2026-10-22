"""Representative HTTP wiring tests for the shared section-access matrix."""

ALL_FEATURES = [
    "paddy",
    "milling",
    "inventory",
    "sales",
    "expenses",
    "employees",
    "users",
    "canva_inventory",
    "reports_advanced",
    "compliance_reports",
]


def test_accountant_gets_operational_reads_but_not_operational_writes(make_auth_client):
    client = make_auth_client(ALL_FEATURES, username="rbac-accountant", role_name="accountant")

    assert client.get("/api/paddy/varieties").status_code == 200
    assert client.post("/api/paddy/suppliers", json={"name": "Blocked"}).status_code == 403

    assert client.get("/api/milling/equipment").status_code == 200
    assert client.post("/api/milling/equipment", json={"name": "Blocked"}).status_code == 403

    assert client.get("/api/inventory/summary").status_code == 200
    assert (
        client.post(
            "/api/inventory/stock",
            json={"inventory_type": "milled_rice", "quantity_kg": 1},
        ).status_code
        == 403
    )

    # Accountant owns these sections and may mutate them.
    assert client.post("/api/sales/customers", json={"name": "Allowed"}).status_code == 201
    assert client.post("/api/costs/categories", json={"name": "Allowed"}).status_code == 201
    assert client.get("/api/reports/revenue-annual").status_code == 200
    assert client.get("/api/employees/").status_code == 200

    assert client.get("/api/users/").status_code == 403


def test_cashier_is_limited_to_sales_and_read_only_stock_dispatch(make_auth_client):
    client = make_auth_client(ALL_FEATURES, username="rbac-cashier", role_name="cashier")

    assert client.get("/api/paddy/varieties").status_code == 403
    assert client.get("/api/milling/equipment").status_code == 403
    assert client.get("/api/inventory/summary").status_code == 200
    assert (
        client.post(
            "/api/inventory/stock",
            json={"inventory_type": "milled_rice", "quantity_kg": 1},
        ).status_code
        == 403
    )

    assert client.post("/api/sales/customers", json={"name": "Cash Sale"}).status_code == 201
    assert client.get("/api/agents").status_code == 200
    assert client.post("/api/agents", json={"name": "Blocked"}).status_code == 403
    assert client.get("/api/dispatch/orders").status_code == 200

    # Financial reports and employee PII are separate, denied sections.
    assert client.get("/api/reports/revenue-annual").status_code == 403
    assert client.get("/api/employees/").status_code == 403
    assert client.get("/api/users/").status_code == 403
    assert client.get("/api/activity/").status_code == 403


def test_mill_operator_can_run_floor_sections_but_cannot_read_sales_or_pii(make_auth_client):
    client = make_auth_client(ALL_FEATURES, username="rbac-mill", role_name="mill_operator")

    assert client.post("/api/paddy/suppliers", json={"name": "Allowed"}).status_code == 201
    assert client.post("/api/milling/equipment", json={"name": "Allowed"}).status_code == 201
    assert client.post("/api/agents", json={"name": "Allowed"}).status_code == 201

    assert client.get("/api/sales/customers").status_code == 403
    assert client.get("/api/costs/categories").status_code == 403
    assert client.get("/api/reports/revenue-annual").status_code == 403
    assert client.get("/api/employees/").status_code == 403


def test_encoder_can_write_paddy_sales_and_milling_but_only_view_inventory(make_auth_client):
    client = make_auth_client(ALL_FEATURES, username="rbac-encoder", role_name="encoder")

    assert client.post("/api/paddy/suppliers", json={"name": "Allowed"}).status_code == 201
    assert client.post("/api/sales/customers", json={"name": "Allowed"}).status_code == 201

    assert client.get("/api/milling/equipment").status_code == 200
    # Encoders encode milling batches, custom milling for walk-in clients included.
    assert client.post("/api/milling/equipment", json={"name": "Allowed"}).status_code == 201
    assert client.get("/api/inventory/summary").status_code == 200
    assert (
        client.post(
            "/api/inventory/stock",
            json={"inventory_type": "milled_rice", "quantity_kg": 1},
        ).status_code
        == 403
    )

    assert client.get("/api/agents").status_code == 403
    # Encoders enter who takes each order (the plate number and the driver).
    assert client.get("/api/dispatch/orders").status_code == 200
