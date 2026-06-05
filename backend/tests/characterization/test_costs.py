"""Characterization: the costs/expenses domain (Phase 3d target)."""


def test_create_category_201(auth_client):
    res = auth_client.post("/api/costs/categories", json={"name": "Fuel"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "Fuel"
    assert body["is_production_cost"] is True


def test_create_category_duplicate_409(auth_client):
    auth_client.post("/api/costs/categories", json={"name": "Fuel"})
    dup = auth_client.post("/api/costs/categories", json={"name": "Fuel"})
    assert dup.status_code == 409
    assert "already exists" in dup.json()["detail"]


def test_create_expense_then_listed(auth_client):
    cat = auth_client.post("/api/costs/categories", json={"name": "Repairs"}).json()
    created = auth_client.post("/api/costs/expenses", json={
        "category_id": cat["id"],
        "expense_date": "2026-06-05",
        "amount": "1500.50",
    })
    assert created.status_code == 201, created.text
    expense_id = created.json()["id"]

    rows = auth_client.get("/api/costs/expenses").json()
    assert any(e["id"] == expense_id and e["category_id"] == cat["id"] for e in rows)
