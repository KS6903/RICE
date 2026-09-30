"""Characterization: tenant billing (Phase 3 sensitive group)."""

from app.models.subscription import SubscriptionPlan

PLAN_KEYS = {
    "id",
    "code",
    "name",
    "description",
    "monthly_price",
    "annual_price",
    "max_users",
    "max_branches",
    "features",
    "is_active",
    "sort_order",
}


def test_list_plans_includes_seeded_plan(auth_client):
    rows = auth_client.get("/api/billing/plans").json()
    assert any(p["code"] == "test" for p in rows)
    assert set(rows[0].keys()) == PLAN_KEYS


def test_my_subscription(auth_client):
    body = auth_client.get("/api/billing/subscription").json()
    assert body["subscription"]["plan_code"] == "test"
    assert body["subscription"]["status"] == "active"


def test_upgrade_request_lifecycle(auth_client, db_session):
    pro = SubscriptionPlan(code="pro", name="Pro", features=["paddy"], is_active=True, sort_order=1)
    db_session.add(pro)
    db_session.flush()

    assert auth_client.get("/api/billing/upgrade-requests/mine").json()["request"] is None

    created = auth_client.post("/api/billing/upgrade-requests", json={"plan_id": str(pro.id)})
    assert created.status_code == 201, created.text
    req = created.json()
    assert req["requested_plan_code"] == "pro"
    assert req["status"] == "pending"
    assert req["billing_interval"] == "monthly"

    mine = auth_client.get("/api/billing/upgrade-requests/mine").json()["request"]
    assert mine["id"] == req["id"]

    # A second pending request is rejected.
    dup = auth_client.post("/api/billing/upgrade-requests", json={"plan_id": str(pro.id)})
    assert dup.status_code == 409

    cancel = auth_client.delete(f"/api/billing/upgrade-requests/{req['id']}")
    assert cancel.status_code == 200


def test_upgrade_request_annual_interval(auth_client, db_session):
    pro = SubscriptionPlan(
        code="pro", name="Pro", monthly_price=1499, annual_price=14990, features=["paddy"], is_active=True
    )
    db_session.add(pro)
    db_session.flush()

    created = auth_client.post(
        "/api/billing/upgrade-requests", json={"plan_id": str(pro.id), "billing_interval": "annual"}
    )
    assert created.status_code == 201, created.text
    assert created.json()["billing_interval"] == "annual"

    plans = auth_client.get("/api/billing/plans").json()
    plan = next(p for p in plans if p["code"] == "pro")
    assert plan["annual_price"] == 14990.0


def test_cannot_request_free_plan_400(auth_client, db_session):
    free = SubscriptionPlan(code="free", name="Free", features=[], is_active=True)
    db_session.add(free)
    db_session.flush()
    res = auth_client.post("/api/billing/upgrade-requests", json={"plan_id": str(free.id)})
    assert res.status_code == 400


def test_cannot_request_current_plan_400(auth_client):
    plans = auth_client.get("/api/billing/plans").json()
    test_plan = next(p for p in plans if p["code"] == "test")
    res = auth_client.post("/api/billing/upgrade-requests", json={"plan_id": test_plan["id"]})
    assert res.status_code == 400
