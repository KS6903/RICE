"""Security characterization for the offline-sync boundary."""

import uuid

from app.models.subscription import Subscription
from app.models.user import Role


def _client(make_auth_client, *, role: str = "owner", features=("offline_sync",)):
    return make_auth_client(features=list(features), role_name=role, username=f"sync-{role}")


def _record(**overrides):
    record = {
        "table_name": "palay_purchases",
        "record_id": str(uuid.uuid4()),
        "operation": "INSERT",
        "payload": {
            "reference_no": f"PP-{uuid.uuid4().hex[:10]}",
            "purchase_date": "2026-06-05",
        },
        "updated_at": "2026-06-05T00:00:00Z",
    }
    record.update(overrides)
    return record


def test_push_then_pull_roundtrips_only_sanitized_payload(make_auth_client):
    client = _client(make_auth_client)
    rec = _record(
        payload={
            "reference_no": "PP-OFFLINE-1",
            "purchase_date": "2026-06-05",
        }
    )
    push = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [rec]},
    )
    assert push.status_code == 200, push.text
    assert push.json() == {"synced": 1, "conflicts": 0}

    pull = client.get("/api/sync/pull", params={"since": "2020-01-01T00:00:00Z"})
    assert pull.status_code == 200, pull.text
    body = pull.json()
    assert "server_time" in body
    assert body["has_more"] is False
    synced = next(r for r in body["records"] if r["record_id"] == rec["record_id"])
    assert synced["payload"]["id"] == rec["record_id"]
    assert synced["payload"]["company_id"]
    assert synced["payload"]["branch_id"]
    assert synced["payload"]["created_by"]


def test_sync_requires_subscription_feature(make_auth_client):
    client = _client(make_auth_client, features=())
    response = client.get("/api/sync/pull", params={"since": "2020-01-01T00:00:00Z"})
    assert response.status_code == 402


def test_push_rejects_unknown_table_operation_and_payload_column(make_auth_client):
    client = _client(make_auth_client)
    bad_table = _record(table_name="users")
    response = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [bad_table]},
    )
    assert response.status_code == 422

    bad_operation = _record(operation="DROP")
    response = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [bad_operation]},
    )
    assert response.status_code == 422

    bad_payload = _record(
        payload={
            "reference_no": "PP-UNSAFE",
            "purchase_date": "2026-06-05",
            "password_hash": "must-never-replicate",
        }
    )
    response = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [bad_payload]},
    )
    assert response.status_code == 422


def test_push_rejects_nested_payload_and_mismatched_identity(make_auth_client):
    client = _client(make_auth_client)
    nested = _record(
        payload={
            "reference_no": "PP-NESTED",
            "purchase_date": "2026-06-05",
            "remarks": {"sql": "not a scalar"},
        }
    )
    response = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [nested]},
    )
    assert response.status_code == 422

    wrong_company = _record(
        payload={
            "reference_no": "PP-WRONG-TENANT",
            "purchase_date": "2026-06-05",
            "company_id": str(uuid.uuid4()),
        }
    )
    response = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [wrong_company]},
    )
    assert response.status_code == 403

    wrong_branch = _record(
        payload={
            "reference_no": "PP-WRONG-BRANCH",
            "purchase_date": "2026-06-05",
            "branch_id": str(uuid.uuid4()),
        }
    )
    response = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [wrong_branch]},
    )
    assert response.status_code == 403

    forged_creator = _record(
        payload={
            "reference_no": "PP-FORGED-CREATOR",
            "purchase_date": "2026-06-05",
            "created_by": str(uuid.uuid4()),
        }
    )
    response = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [forged_creator]},
    )
    assert response.status_code == 403


def test_push_enforces_table_write_role(make_auth_client):
    client = _client(make_auth_client, role="cashier")
    denied = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [_record()]},
    )
    assert denied.status_code == 403

    sales = _record(
        table_name="sales_orders",
        payload={"order_no": "SO-OFFLINE-1", "order_date": "2026-06-05"},
    )
    allowed = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [sales]},
    )
    assert allowed.status_code == 200, allowed.text


def test_pull_filters_tables_by_current_read_role(auth_client, db_session, seed_owner):
    subscription = db_session.query(Subscription).filter(Subscription.company_id == seed_owner.company_id).one()
    subscription.plan.features = [*subscription.plan.features, "offline_sync"]
    db_session.flush()

    record = _record()
    pushed = auth_client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [record]},
    )
    assert pushed.status_code == 200, pushed.text

    cashier = Role(id=5, name="cashier")
    db_session.add(cashier)
    seed_owner.role = cashier
    db_session.flush()

    pulled = auth_client.get("/api/sync/pull", params={"since": "2020-01-01T00:00:00Z"})
    assert pulled.status_code == 200, pulled.text
    assert all(item["record_id"] != record["record_id"] for item in pulled.json()["records"])


def test_duplicate_batch_is_rejected_before_any_record_is_committed(make_auth_client):
    client = _client(make_auth_client)
    record = _record()
    response = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [record, record]},
    )
    assert response.status_code == 422

    pull = client.get("/api/sync/pull", params={"since": "2020-01-01T00:00:00Z"})
    assert pull.status_code == 200
    assert all(item["record_id"] != record["record_id"] for item in pull.json()["records"])


def test_push_bounds_client_id_and_batch_size(make_auth_client):
    client = _client(make_auth_client)
    too_short = client.post(
        "/api/sync/push",
        json={"client_id": "c1", "records": [_record()]},
    )
    assert too_short.status_code == 422

    too_many = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [_record() for _ in range(101)]},
    )
    assert too_many.status_code == 422


def test_pull_requires_timezone_aware_cursor(make_auth_client):
    client = _client(make_auth_client)
    response = client.get("/api/sync/pull", params={"since": "2026-01-01T00:00:00"})
    assert response.status_code == 422


def test_conflicts_are_management_only_and_resolution_is_literal(make_auth_client):
    accountant = _client(make_auth_client, role="accountant")
    assert accountant.get("/api/sync/conflicts").status_code == 403

    owner = _client(make_auth_client, role="owner")
    response = owner.put(
        f"/api/sync/conflicts/{uuid.uuid4()}/resolve",
        json={"resolution": "execute_sql"},
    )
    assert response.status_code == 422


def test_conflicts_list_is_list(make_auth_client):
    client = _client(make_auth_client)
    response = client.get("/api/sync/conflicts")
    assert response.status_code == 200, response.text
    assert isinstance(response.json(), list)
