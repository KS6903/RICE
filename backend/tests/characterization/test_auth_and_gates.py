"""Characterization: health endpoint + the auth/feature gate contract.

These pin the current HTTP behavior so the OOP refactor (global exception
handler, service-layer gates) cannot silently change it. In particular the
402 body shape feeds the frontend billing banner via the `detail` key.
"""


def test_health_returns_ok(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["app"] == "Oraiza by K Systematics"
    assert body["cache"] in ("up", "down")


def test_missing_token_is_401(client):
    # No Authorization header -> OAuth2 scheme rejects before handler runs.
    res = client.get("/api/paddy/varieties")
    assert res.status_code == 401


def test_feature_gate_returns_402_with_detail(make_auth_client):
    # A user whose plan lacks "paddy" must be blocked with 402 + a `detail`
    # string (the frontend interceptor reads response.data.detail).
    c = make_auth_client(features=["inventory"], username="basic")
    res = c.get("/api/paddy/varieties")
    assert res.status_code == 402
    detail = res.json()["detail"]
    assert isinstance(detail, str)
    assert "paddy" in detail


def test_feature_gate_allows_when_plan_includes_it(make_auth_client):
    c = make_auth_client(features=["paddy"], username="withpaddy")
    res = c.get("/api/paddy/varieties")
    assert res.status_code == 200
