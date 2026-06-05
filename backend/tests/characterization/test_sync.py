"""Characterization: the offline-sync domain (Phase 3 target)."""
import uuid


def test_push_then_pull_roundtrips(auth_client):
    rid = str(uuid.uuid4())
    rec = {
        "table_name": "paddy",
        "record_id": rid,
        "operation": "INSERT",
        "payload": {"x": 1},
        "updated_at": "2026-06-05T00:00:00Z",
    }
    push = auth_client.post("/api/sync/push", json={"client_id": "c1", "records": [rec]})
    assert push.status_code == 200, push.text
    assert push.json() == {"synced": 1, "conflicts": 0}

    pull = auth_client.get("/api/sync/pull", params={"since": "2020-01-01T00:00:00Z"})
    assert pull.status_code == 200
    body = pull.json()
    assert "server_time" in body
    assert any(r["record_id"] == rid for r in body["records"])


def test_conflicts_list_is_list(auth_client):
    res = auth_client.get("/api/sync/conflicts")
    assert res.status_code == 200
    assert isinstance(res.json(), list)
