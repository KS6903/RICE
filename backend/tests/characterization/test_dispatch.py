"""Characterization: the dispatch domain (Phase 3 target).

Agents/millers CRUD with system-assigned canva colors, the palette helper, the
dispatch order list, and the courier-assignment / mark-delivered flow.
"""
AGENT_KEYS = {
    "id", "name", "agent_type", "contact_person", "phone", "address",
    "commission_pct", "is_active", "canva_color_hex",
    "deactivated_at", "deactivated_by",
}
MILLER_KEYS = {
    "id", "name", "contact_person", "phone", "address",
    "capacity_kg_per_hr", "milling_fee_per_kg", "is_active", "canva_color_hex",
    "deactivated_at", "deactivated_by",
}
ORDER_KEYS = {
    "id", "order_no", "order_date", "delivery_date", "status", "total_amount",
    "delivered_at", "customer", "assigned_agent", "assigned_miller",
}


def test_create_agent_serialized(auth_client):
    res = auth_client.post("/api/agents", json={"name": "Agent A"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert set(body.keys()) == AGENT_KEYS
    assert body["canva_color_hex"]
    assert body["commission_pct"] == 0.0
    assert body["is_active"] is True


def test_agent_crud_and_soft_delete(auth_client):
    a = auth_client.post("/api/agents", json={"name": "Agent B"}).json()
    assert any(x["id"] == a["id"] for x in auth_client.get("/api/agents").json())

    upd = auth_client.put(f"/api/agents/{a['id']}", json={"name": "Agent B2"})
    assert upd.status_code == 200 and upd.json()["name"] == "Agent B2"

    res = auth_client.delete(f"/api/agents/{a['id']}")
    assert res.status_code == 200 and res.json() == {"ok": True}
    # Soft-deleted: gone from the default (active-only) list.
    assert all(x["id"] != a["id"] for x in auth_client.get("/api/agents").json())


def test_create_miller_serialized(auth_client):
    res = auth_client.post("/api/millers", json={"name": "Miller M"})
    assert res.status_code == 201, res.text
    assert set(res.json().keys()) == MILLER_KEYS
    assert res.json()["canva_color_hex"]


def test_palette_shape(auth_client):
    res = auth_client.get("/api/dispatch/palette")
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"palette", "in_use"}
    assert isinstance(body["palette"], list)


def test_dispatch_orders_courier_and_delivery(auth_client):
    customer = auth_client.post("/api/sales/customers", json={"name": "Disp Co"}).json()
    order = auth_client.post("/api/sales/orders", json={
        "customer_id": customer["id"], "order_date": "2026-06-05",
        "items": [{"item_type": "milled_rice", "quantity_kg": "10", "unit_price_per_kg": "40"}],
    }).json()

    orders = auth_client.get("/api/dispatch/orders").json()
    mine = next(o for o in orders if o["id"] == order["id"])
    assert set(mine.keys()) == ORDER_KEYS

    agent = auth_client.post("/api/agents", json={"name": "Courier A"}).json()
    assigned = auth_client.patch(
        f"/api/sales-orders/{order['id']}/assign-courier", json={"agent_id": agent["id"]}
    )
    assert assigned.status_code == 200
    assert assigned.json()["assigned_agent"]["id"] == agent["id"]
    assert assigned.json()["assigned_miller"] is None

    both = auth_client.patch(
        f"/api/sales-orders/{order['id']}/assign-courier",
        json={"agent_id": agent["id"], "miller_id": agent["id"]},
    )
    assert both.status_code == 400

    delivered = auth_client.patch(f"/api/sales-orders/{order['id']}/mark-delivered")
    assert delivered.status_code == 200
    assert delivered.json()["status"] == "delivered"
    assert delivered.json()["delivered_at"]
