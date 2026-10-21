"""Characterization: the platform-admin domain (Phase 3 sensitive group).

Plan CRUD, platform stats/tenants/users shapes, and the upgrade-request inbox +
approve flow. All endpoints require is_platform_admin.
"""

import uuid
from datetime import datetime, timezone

from app.core.security import hash_password
from app.models.company import Company
from app.models.subscription import SubscriptionPlan
from app.models.upgrade_request import UpgradeRequest
from app.models.user import User
from app.services.legal_service import LegalService

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


def test_plan_annual_price_is_worked_out_from_the_discount(admin_client):
    body = {"code": "adm_annual", "name": "Annual", "monthly_price": 1499, "annual_discount_percent": 16.6667}
    created = admin_client.post("/api/admin/plans", json=body)
    assert created.status_code == 201, created.text
    plan = created.json()
    # Two months free: 10x the monthly price, to the peso.
    assert plan["annual_price"] == 14990.0
    assert plan["annual_discount_percent"] == 16.6667

    # An annual price sent by an older client is ignored, not stored.
    upd = admin_client.put(
        f"/api/admin/plans/{plan['id']}",
        json={**body, "annual_discount_percent": 20, "annual_price": 1},
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["annual_price"] == 14390.0  # 17,988 less 20% is 14,390.40

    no_discount = admin_client.put(f"/api/admin/plans/{plan['id']}", json={**body, "annual_discount_percent": 0})
    assert no_discount.json()["annual_price"] == 17988.0


def test_plan_discount_and_price_must_be_in_range(admin_client):
    base = {"code": "adm_bad", "name": "Bad", "monthly_price": 1000}
    for bad in ({"annual_discount_percent": 100}, {"annual_discount_percent": -1}, {"monthly_price": -5}):
        res = admin_client.post("/api/admin/plans", json={**base, **bad})
        assert res.status_code == 422, bad


def test_stats_shape(admin_client):
    body = admin_client.get("/api/admin/stats").json()
    assert set(body.keys()) == STATS_KEYS


def test_tenants_list_and_detail(admin_client):
    tenants = admin_client.get("/api/admin/tenants").json()
    assert len(tenants) >= 1
    tid = tenants[0]["id"]
    detail = admin_client.get(f"/api/admin/tenants/{tid}").json()
    assert set(detail.keys()) == {"company", "users", "branches", "metrics"}


def test_tenant_legal_acceptance_ledger(admin_client, db_session):
    """The platform admin can read each tenant's acceptance ledger, and only that
    tenant's rows, plus who hasn't accepted the current terms."""

    def mill(name):
        company = Company(name=name)
        db_session.add(company)
        db_session.flush()
        return company

    def member(company, username):
        user = User(
            company_id=company.id,
            username=username,
            password_hash=hash_password("Password123"),
            full_name=username.title(),
            is_active=True,
        )
        db_session.add(user)
        db_session.flush()
        return user

    ours, theirs = mill("Ledger Mill"), mill("Other Mill")
    agreed = member(ours, "agreed")
    member(ours, "pending")
    stranger = member(theirs, "stranger")
    ledger = LegalService(db_session)
    ledger.record_acceptance(user_id=agreed.id, company_id=ours.id, request=None, method="signup")
    ledger.record_acceptance(user_id=stranger.id, company_id=theirs.id, request=None, method="signup")
    db_session.flush()

    res = admin_client.get(f"/api/admin/tenants/{ours.id}/legal-acceptances")
    assert res.status_code == 200, res.text
    body = res.json()
    assert [a["username"] for a in body["acceptances"]] == ["agreed"]
    row = body["acceptances"][0]
    assert row["agreement_version"] == body["agreement_version"]
    assert row["method"] == "signup"
    assert len(row["content_hash"]) == 64
    assert [u["username"] for u in body["not_accepted_current"]] == ["pending"]

    assert admin_client.get(f"/api/admin/tenants/{uuid.uuid4()}/legal-acceptances").status_code == 404


def test_tenant_legal_acceptance_ledger_is_platform_admin_only(make_auth_client):
    owner = make_auth_client(features=[], username="plainowner")
    assert owner.get(f"/api/admin/tenants/{uuid.uuid4()}/legal-acceptances").status_code == 403


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


def test_the_dashboard_survives_a_tenant_that_is_not_provisioned_yet(admin_client, db_session):
    """A tenant waiting for its schema (signup queues it; the provisioner builds
    it within 15 minutes) used to 500 every admin view that counts rows per
    tenant: the query hit a schema that didn't exist and aborted the request."""
    from app.models.company import Company

    waiting = Company(name="Queued Mill", provisioning_requested_at=datetime.now(timezone.utc))
    db_session.add(waiting)
    db_session.commit()
    assert admin_client.get("/api/admin/stats").status_code == 200
    tenants = admin_client.get("/api/admin/tenants")
    assert tenants.status_code == 200
    [row] = [t for t in tenants.json() if t["id"] == str(waiting.id)]
    assert (row["purchases_count"], row["orders_count"]) == (0, 0)
    detail = admin_client.get(f"/api/admin/tenants/{waiting.id}")
    assert detail.status_code == 200, detail.text
