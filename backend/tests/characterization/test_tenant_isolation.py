"""Tenant isolation / IDOR regression tests (security hardening P3).

Company B must never be able to read or modify Company A's rows — by listing
(scoped queries) or by direct id (get_for_company + the assert_company_fk
guards added in P1.8). Foreign ids always read as 404, never 403, so they don't
confirm existence.

Note on fixtures: make_auth_client swaps the get_current_user override, so each
call re-points the SAME TestClient at a new user/company. Do all of company A's
writes before creating company B.
"""


def _mk_customer(client, name="Secret Customer A"):
    res = client.post("/api/sales/customers", json={"name": name})
    assert res.status_code == 201, res.text
    return res.json()


def test_customers_not_listable_or_editable_across_tenants(make_auth_client):
    a = make_auth_client(features=["sales"], username="isoA")
    customer = _mk_customer(a)

    b = make_auth_client(features=["sales"], username="isoB")
    names = [c["name"] for c in b.get("/api/sales/customers").json()]
    assert "Secret Customer A" not in names

    # Direct-id IDOR: updating A's customer by id must read as "not found".
    res = b.put(f"/api/sales/customers/{customer['id']}", json={"name": "pwned"})
    assert res.status_code == 404


def test_order_with_foreign_customer_id_rejected(make_auth_client):
    a = make_auth_client(features=["sales"], username="isoA")
    customer = _mk_customer(a)

    b = make_auth_client(features=["sales"], username="isoB")
    res = b.post(
        "/api/sales/orders",
        json={
            "customer_id": customer["id"],  # belongs to company A
            "order_date": "2026-06-11",
            "items": [{"item_type": "milled_rice", "quantity_kg": "50", "unit_price_per_kg": "45"}],
        },
    )
    assert res.status_code == 404


def test_orders_and_invoices_are_tenant_isolated(make_auth_client):
    a = make_auth_client(features=["sales"], username="isoA")
    customer = _mk_customer(a)
    order = a.post(
        "/api/sales/orders",
        json={
            "customer_id": customer["id"],
            "order_date": "2026-06-11",
            "items": [{"item_type": "milled_rice", "quantity_kg": "50", "unit_price_per_kg": "45"}],
        },
    ).json()

    b = make_auth_client(features=["sales"], username="isoB")
    # B cannot mutate A's order…
    assert b.put(f"/api/sales/orders/{order['id']}", json={"status": "cancelled"}).status_code == 404
    # …nor invoice it.
    res = b.post("/api/sales/invoices", json={"order_id": order["id"], "invoice_date": "2026-06-11"})
    assert res.status_code == 404
    # …and B's order list does not contain it.
    assert all(o["id"] != order["id"] for o in b.get("/api/sales/orders").json())


def test_suppliers_are_tenant_isolated(make_auth_client):
    a = make_auth_client(features=["paddy"], username="isoA")
    sup = a.post("/api/paddy/suppliers", json={"name": "Secret Supplier A"})
    assert sup.status_code == 201
    supplier_id = sup.json()["id"]

    b = make_auth_client(features=["paddy"], username="isoB")
    names = [s["name"] for s in b.get("/api/paddy/suppliers").json()]
    assert "Secret Supplier A" not in names
    assert b.put(f"/api/paddy/suppliers/{supplier_id}", json={"name": "pwned"}).status_code == 404


def test_purchase_with_foreign_supplier_rejected(make_auth_client):
    a = make_auth_client(features=["paddy"], username="isoA")
    supplier_id = a.post("/api/paddy/suppliers", json={"name": "Supplier A"}).json()["id"]

    b = make_auth_client(features=["paddy"], username="isoB")
    res = b.post(
        "/api/paddy/purchases",
        json={
            "supplier_id": supplier_id,  # company A's
            "purchase_date": "2026-06-11",
            "items": [{"gross_weight_kg": "100", "tare_weight_kg": "0", "price_per_cavan": "1200"}],
        },
    )
    assert res.status_code == 404


def test_user_create_with_foreign_branch_rejected(make_auth_client):
    a = make_auth_client(features=["users"], username="isoA")
    branch_a_id = a.get("/api/auth/me").json()["branch_id"]  # company A's main branch

    b = make_auth_client(features=["users"], username="isoB")
    res = b.post(
        "/api/users/",
        json={
            "username": "smuggled.user",
            "password": "validpass1",
            "full_name": "Smuggled",
            "role_id": 1,
            "branch_id": branch_a_id,  # company A's branch
        },
    )
    assert res.status_code == 404


def test_expense_with_foreign_category_rejected(make_auth_client):
    a = make_auth_client(features=["expenses"], username="isoA")
    cat = a.post("/api/costs/categories", json={"name": "Secret Category A"})
    assert cat.status_code == 201, cat.text
    category_id = cat.json()["id"]

    b = make_auth_client(features=["expenses"], username="isoB")
    res = b.post(
        "/api/costs/expenses",
        json={"category_id": category_id, "expense_date": "2026-06-11", "amount": "100"},
    )
    assert res.status_code == 404
