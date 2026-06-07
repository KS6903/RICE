"""Characterization: the warehouse-canva read endpoints (Phase 4 target).

Canva is the largest, most delicate module (spatial state + a realtime
WebSocket). These pin the read contract — especially the auto-bootstrap payload
shape — before any decomposition. The WS and the spatial mutation endpoints get
their own pins as that work proceeds.
"""

LAYOUT_KEYS = {
    "id", "name", "branch_id", "branch_name", "width_m", "height_m",
    "grid_size_m", "version",
}
SUMMARY_KEYS = {"total_pallets", "total_weight_kg", "by_aging"}


def test_get_canva_bootstraps_and_returns_payload(auth_client, seed_owner):
    res = auth_client.get(f"/api/warehouses/{seed_owner.branch_id}/canva")
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body.keys()) == {"layout", "zones", "pallets", "summary"}
    assert set(body["layout"].keys()) == LAYOUT_KEYS
    assert body["layout"]["branch_id"] == str(seed_owner.branch_id)
    assert set(body["summary"].keys()) == SUMMARY_KEYS
    assert set(body["summary"]["by_aging"].keys()) == {"fresh", "warning", "critical", "expired"}
    assert isinstance(body["zones"], list)
    assert isinstance(body["pallets"], list)


def test_get_canva_unknown_branch_404(auth_client):
    res = auth_client.get("/api/warehouses/00000000-0000-0000-0000-000000000000/canva")
    assert res.status_code == 404


def test_branch_layouts_listed_after_bootstrap(auth_client, seed_owner):
    # The bootstrap on the canva read creates the default layout.
    auth_client.get(f"/api/warehouses/{seed_owner.branch_id}/canva")
    res = auth_client.get(f"/api/branches/{seed_owner.branch_id}/layouts")
    assert res.status_code == 200
    layouts = res.json()
    assert isinstance(layouts, list)
    assert len(layouts) >= 1


def test_zone_types_and_size_presets_shapes(auth_client):
    zt = auth_client.get("/api/canva/zone-types")
    assert zt.status_code == 200
    body = zt.json()
    assert set(body.keys()) == {"storage", "structural"}
    assert isinstance(body["storage"], list) and isinstance(body["structural"], list)

    presets = auth_client.get("/api/warehouse-size-presets")
    assert presets.status_code == 200
    assert isinstance(presets.json(), list)


def test_canva_requires_canva_inventory_feature(make_auth_client):
    # Has 'inventory' but not 'canva_inventory' -> the second gate returns 402.
    c = make_auth_client(features=["inventory"], username="noc")
    branch_id = "00000000-0000-0000-0000-000000000000"
    res = c.get(f"/api/warehouses/{branch_id}/canva")
    assert res.status_code == 402
