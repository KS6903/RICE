"""Characterization: the branches domain (Phase 3 target).

Covers company read, the multi-branch 402 gate, and the soft-delete
trash/restore lifecycle (bulk-delete skip rules, trash listing with
days_remaining, restore).
"""

TRASH_KEYS = {"id", "name", "is_main_branch", "deleted_at", "deleted_by_name", "days_remaining"}


def test_list_branches_includes_main(auth_client):
    rows = auth_client.get("/api/branches/").json()
    assert any(b["is_main_branch"] for b in rows)


def test_get_company(auth_client):
    res = auth_client.get("/api/branches/company")
    assert res.status_code == 200
    assert res.json()["name"] == "Test Mill"


def test_create_second_branch_requires_multi_branch(auth_client):
    # Seeded owner already has a main branch and no multi_branch feature.
    res = auth_client.post("/api/branches/", json={"name": "Branch 2"})
    assert res.status_code == 402
    assert "multi-branch" in res.json()["detail"].lower()


def test_bulk_delete_skips_main(auth_client):
    main = next(b for b in auth_client.get("/api/branches/").json() if b["is_main_branch"])
    res = auth_client.post("/api/branches/bulk-delete", json={"ids": [main["id"]]})
    assert res.status_code == 200
    body = res.json()
    assert main["id"] not in body["deleted"]
    assert any(s["id"] == main["id"] for s in body["skipped"])


def test_trash_then_restore_flow(make_auth_client):
    c = make_auth_client(features=["multi_branch"], username="mb")

    created = c.post("/api/branches/", json={"name": "Warehouse 2"})
    assert created.status_code == 201, created.text
    bid = created.json()["id"]

    # Trash it.
    res = c.post("/api/branches/bulk-delete", json={"ids": [bid]})
    assert res.status_code == 200
    assert bid in res.json()["deleted"]

    # Gone from the live list, present in trash with the expected shape.
    assert all(b["id"] != bid for b in c.get("/api/branches/").json())
    trash = c.get("/api/branches/trash").json()
    row = next(t for t in trash if t["id"] == bid)
    assert set(row.keys()) == TRASH_KEYS
    assert row["days_remaining"] >= 28

    # Restore it.
    restored = c.post(f"/api/branches/{bid}/restore")
    assert restored.status_code == 200
    assert restored.json()["restored"] is True
    assert any(b["id"] == bid for b in c.get("/api/branches/").json())


def test_restore_non_trashed_409(make_auth_client):
    c = make_auth_client(features=["multi_branch"], username="mb2")
    main = next(b for b in c.get("/api/branches/").json() if b["is_main_branch"])
    res = c.post(f"/api/branches/{main['id']}/restore")
    assert res.status_code == 409
