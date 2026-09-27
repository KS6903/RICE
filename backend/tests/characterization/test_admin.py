"""Characterization: the platform-admin domain (Phase 3 sensitive group).

Plan CRUD, platform stats/tenants/users shapes, and the upgrade-request inbox +
approve flow. All endpoints require is_platform_admin.
"""

import uuid

from app.models.subscription import SubscriptionPlan
from app.models.upgrade_request import UpgradeRequest

STATS_KEYS = {
    "total_tenants",
    "total_branches",
    "total_users",
    "total_purchases",
    "total_batches",
    "total_orders",
    "new_tenants_30d",
    "active_users_7d",
    "subscribed_users",
    "unsubscribed_users",
}


def test_admin_endpoints_require_platform_admin(make_auth_client):
    owner = make_auth_client(features=[], username="plainowner")  # not a platform admin
    assert owner.get("/api/admin/stats").status_code == 403


def test_plan_crud_lifecycle(admin_client):
    created = admin_client.post("/api/admin/plans", json={"code": "adm_test", "name": "Admin Test"})
    assert created.status_code == 201, created.text
    pid = created.json()["id"]

    dup = admin_client.post("/api/admin/plans", json={"code": "adm_test", "name": "Dup"})
    assert dup.status_code == 409

    upd = admin_client.put(f"/api/admin/plans/{pid}", json={"code": "adm_test", "name": "Admin Test 2"})
    assert upd.status_code == 200
    assert upd.json()["name"] == "Admin Test 2"

    deleted = admin_client.delete(f"/api/admin/plans/{pid}")
    assert deleted.status_code == 200


def test_stats_shape(admin_client):
    body = admin_client.get("/api/admin/stats").json()
    assert set(body.keys()) == STATS_KEYS


def test_tenants_list_and_detail(admin_client):
    tenants = admin_client.get("/api/admin/tenants").json()
    assert len(tenants) >= 1
    tid = tenants[0]["id"]
    detail = admin_client.get(f"/api/admin/tenants/{tid}").json()
    assert set(detail.keys()) == {"company", "users", "branches", "metrics"}


def test_list_all_users(admin_client):
    rows = admin_client.get("/api/admin/users").json()
    assert isinstance(rows, list)


def test_upgrade_request_inbox_and_approve(admin_client, db_session):
    tid = uuid.UUID(admin_client.get("/api/admin/tenants").json()[0]["id"])
    pro = SubscriptionPlan(code="proX", name="Pro X", features=["paddy"], is_active=True)
    db_session.add(pro)
    db_session.flush()
    req = UpgradeRequest(
        company_id=tid,
        requested_plan_id=pro.id,
        status="pending",
        request_type="upgrade",
    )
    db_session.add(req)
    db_session.flush()

    pending = admin_client.get("/api/admin/upgrade-requests").json()
    assert any(r["id"] == str(req.id) for r in pending)

    count = admin_client.get("/api/admin/upgrade-requests/pending-count").json()
    assert count["pending"] >= 1

    approved = admin_client.post(f"/api/admin/upgrade-requests/{req.id}/approve", json={})
    assert approved.status_code == 200


def test_reject_unknown_request_404(admin_client):
    res = admin_client.post("/api/admin/upgrade-requests/00000000-0000-0000-0000-000000000000/reject", json={})
    assert res.status_code == 404
