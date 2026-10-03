"""What the desktop app relies on: a refusal of one sync record says so, so the
app sets that record aside instead of stalling; and a build that's too old is
told to update before it reads or writes anything."""

from __future__ import annotations

import uuid

import pytest

from app.core import client_version
from app.core.config import settings
from app.services.sync_service import REJECTION_HEADER


def _client(make_auth_client, *, role: str = "owner", features=("offline_sync",)):
    return make_auth_client(features=list(features), role_name=role, username=f"desk-{role}")


def _push(client, **record):
    body = {
        "table_name": "palay_purchases",
        "record_id": str(uuid.uuid4()),
        "operation": "INSERT",
        "payload": {"reference_no": f"PP-{uuid.uuid4().hex[:8]}", "purchase_date": "2026-06-05"},
        "updated_at": "2026-06-05T00:00:00Z",
        **record,
    }
    return client.post("/api/sync/push", json={"client_id": "electron-12345678", "records": [body]})


# ── sync: one record's refusal is marked as such ─────────────────────────────


def test_a_record_the_server_cannot_take_is_marked(make_auth_client):
    client = _client(make_auth_client)
    bad_field = _push(client, payload={"reference_no": "PP-1", "purchase_date": "2026-06-05", "nope": 1})
    other_company = _push(
        client, payload={"reference_no": "PP-2", "purchase_date": "2026-06-05", "company_id": str(uuid.uuid4())}
    )
    assert (bad_field.status_code, bad_field.headers.get(REJECTION_HEADER)) == (422, "record")
    assert (other_company.status_code, other_company.headers.get(REJECTION_HEADER)) == (403, "record")


def test_a_table_this_role_cannot_write_is_marked(make_auth_client):
    response = _push(_client(make_auth_client, role="cashier"))
    assert (response.status_code, response.headers.get(REJECTION_HEADER)) == (403, "record")


@pytest.mark.parametrize(
    ("role", "features", "status"),
    [("owner", (), 402), ("guest", ("offline_sync",), 403)],
    ids=["plan without sync", "role without sync"],
)
def test_a_refusal_of_the_account_is_not(make_auth_client, role, features, status):
    """Setting records aside would be wrong here: none of them would fare better."""
    response = _push(_client(make_auth_client, role=role, features=features))
    assert response.status_code == status
    assert REJECTION_HEADER not in response.headers


# ── the oldest desktop app served ────────────────────────────────────────────


@pytest.fixture
def minimum(monkeypatch):
    monkeypatch.setattr(settings, "DESKTOP_MIN_VERSION", "1.2.0")
    return "1.2.0"


def test_an_old_desktop_build_is_told_to_update(client, minimum):
    response = client.get("/api/auth/me", headers={client_version.HEADER: "1.1.9"})
    assert response.status_code == 426
    assert response.json()["minimum_version"] == minimum
    assert response.headers.get("X-Content-Type-Options") == "nosniff"  # still hardened


@pytest.mark.parametrize("version", ["1.2.0", "1.10.0", "2.0.0-beta.1"])
def test_a_current_build_is_served(client, minimum, version):
    assert client.get("/api/auth/me", headers={client_version.HEADER: version}).status_code == 401


def test_browsers_and_health_checks_are_never_turned_away(client, minimum):
    assert client.get("/api/auth/me").status_code == 401  # no header: a browser
    assert client.get("/api/health", headers={client_version.HEADER: "0.1.0"}).status_code == 200


def test_without_a_minimum_every_build_is_served(client):
    assert client.get("/api/auth/me", headers={client_version.HEADER: "0.0.1"}).status_code == 401


@pytest.mark.parametrize(
    ("version", "expected"),
    [("1.1.9", True), ("1.2.0", False), ("1.2.1", False), ("10.0.0", False), ("garbage", True), ("1.2", True)],
)
def test_versions_compare_as_numbers(version, expected):
    assert client_version.too_old(version, "1.2.0") is expected
