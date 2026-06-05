"""Smoke test: proves the test harness (DB, isolation, auth override) works.

Not a characterization test — just validates conftest wiring before we build the
golden-snapshot suite on top of it.
"""


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_paddy_variety_roundtrip(auth_client):
    created = auth_client.post(
        "/api/paddy/varieties",
        json={"code": "NSIC", "name": "NSIC Rc222"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["code"] == "NSIC"

    listed = auth_client.get("/api/paddy/varieties")
    assert listed.status_code == 200
    assert any(v["code"] == "NSIC" for v in listed.json())
