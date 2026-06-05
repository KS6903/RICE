"""Characterization: the saved-locations domain CRUD (Phase 3 target).

The geocoding search proxy hits an external API and is not exercised here; its
validation/rate-limit/reshape behavior is preserved verbatim in the refactor.
"""

LOCATION_KEYS = {"id", "label", "lat", "lon", "country", "region", "is_default", "created_at"}


def _add(c, label, lat=14.6, lon=121.0, **extra):
    return c.post("/api/locations", json={"label": label, "lat": lat, "lon": lon, **extra})


def test_create_first_location_is_default(auth_client):
    res = _add(auth_client, "Manila")
    assert res.status_code == 201, res.text
    body = res.json()
    assert set(body.keys()) == LOCATION_KEYS
    assert body["is_default"] is True
    assert body["lat"] == 14.6


def test_dedupe_on_label_returns_existing(auth_client):
    a = _add(auth_client, "Cebu", lat=10.3, lon=123.9).json()
    b = _add(auth_client, "Cebu", lat=11.0, lon=124.0).json()
    assert a["id"] == b["id"]


def test_second_location_not_default_then_set_default(auth_client):
    first = _add(auth_client, "Manila").json()
    second = _add(auth_client, "Davao", lat=7.1, lon=125.6).json()
    assert second["is_default"] is False

    res = auth_client.patch(f"/api/locations/{second['id']}/set-default")
    assert res.status_code == 200
    assert res.json()["is_default"] is True

    rows = {r["id"]: r for r in auth_client.get("/api/locations").json()}
    assert rows[first["id"]]["is_default"] is False
    assert rows[second["id"]]["is_default"] is True


def test_delete_default_promotes_sibling(auth_client):
    first = _add(auth_client, "Manila").json()
    second = _add(auth_client, "Iloilo", lat=10.7, lon=122.5).json()

    res = auth_client.delete(f"/api/locations/{first['id']}")
    assert res.status_code == 204

    rows = {r["id"]: r for r in auth_client.get("/api/locations").json()}
    assert first["id"] not in rows
    assert rows[second["id"]]["is_default"] is True


def test_set_default_unknown_404(auth_client):
    res = auth_client.patch("/api/locations/00000000-0000-0000-0000-000000000000/set-default")
    assert res.status_code == 404
