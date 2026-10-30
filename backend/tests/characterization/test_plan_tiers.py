"""What each plan opens, after 019_plan_tiers: Basic unlocks milling and
dispatch and the drying advisor; Pro unlocks field operators, cash count,
collections and employees; automations, the To do list, stock count and maintenance
stay Enterprise only.

The plans are built from the baseline migration's feature lists plus 019's
grants, so this follows the migrations rather than a copy of them.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from app.models.subscription import Subscription
from app.models.user import Role

VERSIONS = Path(__file__).resolve().parents[2] / "migrations" / "versions"


def _migration(name: str):
    spec = importlib.util.spec_from_file_location(name, VERSIONS / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _plans() -> dict[str, list[str]]:
    baseline = {p["code"]: list(p["features"]) for p in _migration("001_public_baseline").PLANS}
    tiers = _migration("019_plan_tiers")
    plans = {}
    for code, features in baseline.items():
        granted = set(features) | set(tiers.GRANTS.get(code, ()))
        if code == "free":
            granted.discard("milling")
        plans[code] = sorted(granted)
    # Granted to Enterprise by their own migrations (004, 009, 016).
    plans["enterprise"] += ["automations", "drying_advisor", "canva_inventory"]
    plans["enterprise"] = sorted(set(plans["enterprise"]))
    plans["pro"] += ["canva_inventory"]
    # 030_profit_calculator.
    plans["pro"] += ["profit"]
    plans["enterprise"] += ["profit"]
    return plans


PLANS = _plans()

# One list endpoint per page, and the plan that first opens it.
PAGES = {
    "/api/sales/orders": "free",
    "/api/paddy/purchases": "free",
    "/api/milling/batches": "basic",
    "/api/dispatch/orders": "basic",
    "/api/fleet/trucks": "basic",
    "/api/agents": "pro",
    "/api/millers": "pro",
    "/api/cash/": "pro",
    "/api/collections/": "pro",
    "/api/employees/": "pro",
    "/api/profit/varieties": "pro",
    "/api/drying-advisory": "basic",
    "/api/automations/": "enterprise",
    "/api/actions/": "enterprise",
    "/api/stock-counts/": "enterprise",
    "/api/equipment/": "enterprise",
}
ORDER = ["free", "basic", "pro", "enterprise"]


@pytest.mark.parametrize("plan", ORDER)
def test_each_plan_opens_its_pages_and_no_more(make_auth_client, plan):
    client = make_auth_client(PLANS[plan], username=plan)
    for path, first_plan in PAGES.items():
        status = client.get(path).status_code
        if ORDER.index(plan) >= ORDER.index(first_plan):
            # Open, though not always a 200: the drying advisor answers 501
            # when no AI key is set, as in these tests.
            opened = status not in (402, 403) and (status < 500 or status == 501)
            assert opened, f"{plan} should open {path}, got {status}"
        else:
            assert status == 402, f"{plan} should be refused {path}, got {status}"


def test_the_palay_pages_to_do_window_is_for_pro_and_enterprise_only():
    # 029_page_todo: the Palay page's own To do window. The overall To do page
    # (the automations feature) stays Enterprise only.
    todo = _migration("029_page_todo")
    assert todo.CODE == "page_todo"
    assert todo.PLANS == ("pro", "enterprise")
    assert "page_todo" not in PLANS["free"] + PLANS["basic"]


def test_the_profit_calculator_is_for_pro_and_enterprise_only():
    profit = _migration("030_profit_calculator")
    assert profit.CODE == "profit"
    assert profit.PLANS == ("pro", "enterprise")
    assert "profit" not in PLANS["free"] + PLANS["basic"]


def test_free_no_longer_includes_milling():
    assert "milling" not in PLANS["free"]
    assert {"milling", "dispatch"} <= set(PLANS["basic"])


def test_basic_seats_five_users_the_owner_included(auth_client, db_session, seed_owner):
    """Basic's five seats: the owner and four staff. The fifth staff member is
    refused with the upgrade prompt."""
    seats = _migration("019_plan_tiers").BASIC_MAX_USERS
    assert seats == 5
    plan = db_session.query(Subscription).filter(Subscription.company_id == seed_owner.company_id).one().plan
    plan.max_users = seats
    db_session.add(Role(id=5, name="cashier"))
    db_session.flush()

    def add(n: int):
        return auth_client.post(
            "/api/users/",
            json={
                "username": f"staff{n}",
                "password": "Password123!x",
                "full_name": f"Staff {n}",
                "role_id": 5,
            },
        )

    # The owner holds the first seat.
    for n in range(1, 5):
        assert add(n).status_code == 201, f"staff {n} should fit"
    refused = add(5)
    assert refused.status_code == 402
    assert "up to 5 users" in refused.json()["detail"]


def test_warehouses_per_plan():
    assert _migration("019_plan_tiers").MAX_WAREHOUSES == {
        "free": 1,
        "basic": 3,
        "pro": 5,
        "enterprise": None,
    }


def test_a_warehouse_past_the_limit_is_refused(auth_client, db_session, seed_owner):
    """Basic's three branches: the main one and two more."""
    plan = db_session.query(Subscription).filter(Subscription.company_id == seed_owner.company_id).one().plan
    plan.max_branches = _migration("019_plan_tiers").MAX_WAREHOUSES["basic"]
    plan.features = [*plan.features, "multi_branch"]  # as Basic has
    db_session.flush()
    for n in (2, 3):
        assert auth_client.post("/api/branches/", json={"name": f"Warehouse {n}"}).status_code == 201
    refused = auth_client.post("/api/branches/", json={"name": "Warehouse 4"})
    assert refused.status_code == 402
    assert "up to 3 branches" in refused.json()["detail"]
