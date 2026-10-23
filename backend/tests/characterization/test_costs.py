"""Characterization: the costs/expenses domain (Phase 3d target)."""

DEFAULTS = {"Fuel", "Electricity", "Labor", "Maintenance", "Sacks/Packaging", "Office/Admin"}


def _categories(client) -> dict[str, dict]:
    return {c["name"]: c for c in client.get("/api/costs/categories").json()}


def _expense(client, category_id: str) -> str:
    res = client.post(
        "/api/costs/expenses",
        json={"category_id": category_id, "expense_date": "2026-06-05", "amount": "250"},
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_a_new_mill_starts_with_the_default_categories(auth_client):
    cats = _categories(auth_client)
    assert DEFAULTS <= set(cats)
    assert all(cats[name]["is_default"] for name in DEFAULTS)
    assert cats["Office/Admin"]["is_production_cost"] is False
    assert cats["Fuel"]["expense_count"] == 0


def test_create_category_201(auth_client):
    res = auth_client.post("/api/costs/categories", json={"name": "Rice hull hauling"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "Rice hull hauling"
    assert body["is_production_cost"] is True
    assert body["is_default"] is False


def test_create_category_duplicate_409(auth_client):
    auth_client.post("/api/costs/categories", json={"name": "Repairs"})
    dup = auth_client.post("/api/costs/categories", json={"name": "Repairs"})
    assert dup.status_code == 409
    assert "already exists" in dup.json()["detail"]
    # A default's name is taken too, whatever the case.
    assert auth_client.post("/api/costs/categories", json={"name": "fuel"}).status_code == 409


def test_a_default_can_be_renamed_and_change_type(auth_client):
    fuel = _categories(auth_client)["Fuel"]
    res = auth_client.put(f"/api/costs/categories/{fuel['id']}", json={"name": "Diesel", "is_production_cost": False})
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["name"], body["is_production_cost"], body["is_default"]) == ("Diesel", False, True)


def test_a_rename_cannot_take_another_categorys_name(auth_client):
    fuel = _categories(auth_client)["Fuel"]
    res = auth_client.put(f"/api/costs/categories/{fuel['id']}", json={"name": "electricity"})
    assert res.status_code == 409


def test_a_default_cannot_be_deleted(auth_client):
    fuel = _categories(auth_client)["Fuel"]
    res = auth_client.delete(f"/api/costs/categories/{fuel['id']}")
    assert res.status_code == 409
    assert res.json()["code"] == "category_is_default"
    assert "Fuel" in _categories(auth_client)


def test_an_added_category_can_be_deleted(auth_client):
    cat = auth_client.post("/api/costs/categories", json={"name": "Snacks"}).json()
    assert auth_client.delete(f"/api/costs/categories/{cat['id']}").status_code == 204
    assert "Snacks" not in _categories(auth_client)


def test_a_category_in_use_moves_its_expenses_before_it_goes(auth_client):
    cat = auth_client.post("/api/costs/categories", json={"name": "Generator"}).json()
    expense_id = _expense(auth_client, cat["id"])
    assert _categories(auth_client)["Generator"]["expense_count"] == 1

    refused = auth_client.delete(f"/api/costs/categories/{cat['id']}")
    assert refused.status_code == 409
    assert refused.json()["code"] == "category_in_use"

    fuel = _categories(auth_client)["Fuel"]
    moved = auth_client.delete(f"/api/costs/categories/{cat['id']}", params={"move_to": fuel["id"]})
    assert moved.status_code == 204, moved.text
    rows = auth_client.get("/api/costs/expenses").json()
    assert next(e for e in rows if e["id"] == expense_id)["category_id"] == fuel["id"]
    assert "Generator" not in _categories(auth_client)


def test_create_expense_then_listed(auth_client):
    cat = auth_client.post("/api/costs/categories", json={"name": "Repairs"}).json()
    expense_id = _expense(auth_client, cat["id"])
    rows = auth_client.get("/api/costs/expenses").json()
    assert any(e["id"] == expense_id and e["category_id"] == cat["id"] for e in rows)
