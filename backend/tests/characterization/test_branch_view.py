"""Characterization: the Boss looks at one branch at a time, or all of them.

The web app names the branch in the X-Branch header (a branch id, or "all").
Lists and reports keep to it, and new records go into it. Without the header,
or with one naming no branch of the mill, everything is as it always was.
"""

import uuid
from types import SimpleNamespace

from app.core import branch_scope
from app.models.company import Branch

BEARER = {"X-Client-Type": "bearer"}


def _boss(client) -> dict:
    res = client.post("/api/auth/login", data={"username": "owner", "password": "Password123"}, headers=BEARER)
    assert res.status_code == 200, res.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _north(db_session, owner) -> Branch:
    north = Branch(company_id=owner.company_id, name="North Branch", is_main_branch=False)
    db_session.add(north)
    db_session.flush()
    return north


def _expense(client, headers, amount: str) -> dict:
    fuel = next(c for c in client.get("/api/costs/categories", headers=headers).json() if c["name"] == "Fuel")
    res = client.post(
        "/api/costs/expenses",
        json={"category_id": fuel["id"], "expense_date": "2026-10-20", "amount": amount},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    return res.json()


def _amounts(client, headers) -> list[float]:
    return sorted(float(e["amount"]) for e in client.get("/api/costs/expenses", headers=headers).json())


def test_new_records_go_to_the_branch_being_viewed(client, db_session, seed_owner):
    north = _north(db_session, seed_owner)
    boss = _boss(client)
    in_north = {**boss, "X-Branch": str(north.id)}
    in_main = {**boss, "X-Branch": str(seed_owner.branch_id)}

    assert _expense(client, in_north, "100")["branch_id"] == str(north.id)
    assert _expense(client, in_main, "250")["branch_id"] == str(seed_owner.branch_id)
    # "All branches": new records go to the Boss's own branch.
    assert _expense(client, {**boss, "X-Branch": "all"}, "40")["branch_id"] == str(seed_owner.branch_id)

    assert _amounts(client, in_north) == [100.0]
    assert _amounts(client, in_main) == [40.0, 250.0]
    assert _amounts(client, {**boss, "X-Branch": "all"}) == [40.0, 100.0, 250.0]
    assert _amounts(client, boss) == [40.0, 100.0, 250.0]


def test_reports_add_up_the_branch_being_viewed(client, db_session, seed_owner):
    north = _north(db_session, seed_owner)
    boss = _boss(client)
    _expense(client, {**boss, "X-Branch": str(north.id)}, "100")
    _expense(client, {**boss, "X-Branch": str(seed_owner.branch_id)}, "250")
    period = {"period_start": "2026-10-01", "period_end": "2026-10-31"}

    def spent(headers) -> float:
        res = client.get("/api/reports/pnl", params=period, headers=headers)
        assert res.status_code == 200, res.text
        return res.json()["operating_expenses"]

    assert spent({**boss, "X-Branch": str(north.id)}) == 100.0
    assert spent({**boss, "X-Branch": "all"}) == 350.0


def test_a_branch_that_isnt_the_mills_is_ignored(client, db_session, seed_owner):
    north = _north(db_session, seed_owner)
    boss = _boss(client)
    _expense(client, {**boss, "X-Branch": str(north.id)}, "100")
    _expense(client, boss, "250")
    stranger = {**boss, "X-Branch": str(uuid.uuid4())}
    assert _amounts(client, stranger) == [100.0, 250.0]
    assert _expense(client, stranger, "5")["branch_id"] == str(seed_owner.branch_id)


def test_the_picker_opens_where_the_boss_chose(client, db_session, seed_owner):
    north = _north(db_session, seed_owner)
    boss = _boss(client)
    assert client.get("/api/auth/me", headers=boss).json()["branch_view_default"] == "main"

    for view in (str(north.id), "all", "main"):
        res = client.put("/api/auth/branch-view", json={"view": view}, headers=boss)
        assert res.status_code == 200, res.text
        assert client.get("/api/auth/me", headers=boss).json()["branch_view_default"] == view

    assert client.put("/api/auth/branch-view", json={"view": str(uuid.uuid4())}, headers=boss).status_code == 404


def test_only_the_boss_and_admins_pick_a_branch():
    north = uuid.uuid4()
    branch = SimpleNamespace(id=north, company_id="c1", deleted_at=None)
    db = SimpleNamespace(info={}, get=lambda model, key: branch)
    cashier = SimpleNamespace(role=SimpleNamespace(name="cashier"), company_id="c1", branch_id="home")
    branch_scope.resolve(db, str(north), cashier)
    assert branch_scope.viewed_branch(db) is None
    assert cashier.branch_id == "home"


def test_a_choice_never_outlives_its_request(db_session, seed_owner):
    """The tests' requests share one session; a real one gets its own."""
    north = _north(db_session, seed_owner)
    home = seed_owner.branch_id
    branch_scope.resolve(db_session, str(north.id), seed_owner)
    assert (branch_scope.viewed_branch(db_session), seed_owner.branch_id) == (north.id, north.id)

    branch_scope.resolve(db_session, "all", seed_owner)
    assert (branch_scope.viewed_branch(db_session), seed_owner.branch_id) == (None, home)
