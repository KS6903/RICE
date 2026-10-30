"""The Profit calculator over HTTP: the real figures reach the Boss alone. Staff the
Boss opens the page to get a lower figure and nothing to work the real one back from."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.core.security import get_current_user
from app.main import app
from app.models.paddy import PalayPurchase, PalayPurchaseItem
from app.models.reference import RiceVariety
from app.models.sales import SalesOrder, SalesOrderItem
from app.models.user import Role
from app.services.profit_service import price_plan

ALL_FEATURES = ["paddy", "milling", "sales", "expenses", "profit"]

# Cost figures a staff response must never carry.
SECRET_KEYS = {
    "break_even",
    "market_price",
    "margin_pct",
    "profit",
    "total_cost",
    "palay_price",
    "byproduct_income",
    "other_cost_per_kg",
}
STAFF_KEYS = {
    "variety_id",
    "code",
    "name",
    "recovery_pct",
    "recommended_price",
    "estimated_profit_per_kg",
    "verdict",
}


def _yesterday():
    # A day back: the tests' clock may be ahead of the mill's timezone.
    return (datetime.now(timezone.utc) - timedelta(days=1)).date()


def _current_user():
    return app.dependency_overrides[get_current_user]()


def _stock_the_mill(db_session, *, market_price: str) -> None:
    """A variety with 1,000 kg of palay bought at ₱20 and rice sold at a price."""
    user = _current_user()
    today = _yesterday()
    variety = RiceVariety(company_id=user.company_id, code="RC222", name="Rc 222", kind="palay", is_active=True)
    db_session.add(variety)
    db_session.flush()
    purchase = PalayPurchase(
        company_id=user.company_id,
        branch_id=user.branch_id,
        reference_no="PP-TEST-1",
        purchase_date=today,
        status="received",
    )
    purchase.items.append(
        PalayPurchaseItem(
            variety_id=variety.id,
            gross_weight_kg=Decimal("1000"),
            tare_weight_kg=Decimal("0"),
            cavan_count=Decimal("20"),
            price_per_cavan=Decimal("1000"),
        )
    )
    price = Decimal(market_price)
    order = SalesOrder(
        company_id=user.company_id,
        branch_id=user.branch_id,
        order_no="SO-TEST-1",
        order_date=today,
        status="paid",
        subtotal=100 * price,
        total_amount=100 * price,
    )
    order.items.append(
        SalesOrderItem(
            item_type="milled_rice",
            variety_id=variety.id,
            quantity_kg=Decimal("100"),
            unit_price_per_kg=price,
        )
    )
    db_session.add_all([purchase, order])
    db_session.flush()


def _open_to(role: str) -> None:
    _current_user().company.role_access = {role: {"profit": "view"}}


def _make_boss(db_session) -> None:
    user = _current_user()
    role = Role(id=90, name="owner")
    db_session.add(role)
    db_session.flush()
    user.role = role
    db_session.flush()


def test_the_page_is_closed_to_staff_until_the_boss_opens_it(make_auth_client):
    client = make_auth_client(ALL_FEATURES, role_name="accountant")
    assert client.get("/api/profit/varieties").status_code == 403


def test_staff_get_a_lower_figure_and_no_costs(make_auth_client, db_session):
    client = make_auth_client(ALL_FEATURES, role_name="accountant")
    _stock_the_mill(db_session, market_price="40")
    _open_to("accountant")

    response = client.get("/api/profit/varieties")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    row = rows[0]
    assert set(row) == STAFF_KEYS
    assert not SECRET_KEYS & set(row)

    # 1,000 kg at ₱20, the usual 65%, 20% ipa and 10% darak with no by-product sales:
    # break-even ₱30.77, so at the ₱40 market the real profit is ₱9.23 a kilo.
    plan = price_plan(
        palay_kg=1000.0,
        palay_price=20.0,
        moisture_pct=None,
        recovery_pct=65.0,
        other_costs=0.0,
        byproducts=[],
        target_margin_pct=10.0,
        market_price=40.0,
    )
    real = plan["recommended_price"] - plan["break_even"]
    assert row["recommended_price"] == 40.0
    assert row["estimated_profit_per_kg"] == pytest.approx(real * 0.3, abs=0.01)
    assert row["estimated_profit_per_kg"] < real / 2


def test_changing_the_staff_share_changes_what_staff_see(make_auth_client, db_session):
    client = make_auth_client(ALL_FEATURES, role_name="accountant")
    _stock_the_mill(db_session, market_price="40")
    _open_to("accountant")
    before = client.get("/api/profit/varieties").json()[0]["estimated_profit_per_kg"]

    _current_user().company.staff_profit_pct = Decimal("60")
    db_session.flush()
    after = client.get("/api/profit/varieties").json()[0]["estimated_profit_per_kg"]
    assert after == pytest.approx(before * 2, abs=0.02)


def test_staff_get_no_number_on_a_losing_lot(make_auth_client, db_session):
    client = make_auth_client(ALL_FEATURES, role_name="accountant")
    _stock_the_mill(db_session, market_price="25")
    _open_to("accountant")
    row = client.get("/api/profit/varieties").json()[0]
    assert row["verdict"] == "losing"
    assert row["estimated_profit_per_kg"] is None


@pytest.mark.parametrize("path", ["/api/profit/settings", "/api/profit/period?start=2026-01-01&end=2026-01-31"])
def test_staff_are_refused_the_bosss_endpoints(make_auth_client, path):
    client = make_auth_client(ALL_FEATURES, role_name="accountant")
    _open_to("accountant")
    assert client.get(path).status_code == 403


def test_staff_can_t_read_the_calculators_figures_or_change_the_settings(make_auth_client, db_session):
    client = make_auth_client(ALL_FEATURES, role_name="accountant")
    _stock_the_mill(db_session, market_price="40")
    _open_to("accountant")
    variety = db_session.query(RiceVariety).filter_by(code="RC222").one()
    assert client.get(f"/api/profit/defaults?variety_id={variety.id}").status_code == 403
    assert client.put("/api/profit/settings", json={"staff_profit_pct": 100}).status_code == 403


def test_a_platform_admin_doesn_t_get_the_real_figures(make_auth_client):
    client = make_auth_client(ALL_FEATURES, username="pa", role_name="owner", is_platform_admin=True)
    assert client.get("/api/profit/settings").status_code == 403


def test_the_boss_gets_the_real_figures(make_auth_client, db_session):
    client = make_auth_client(ALL_FEATURES, role_name="accountant")
    _stock_the_mill(db_session, market_price="40")
    _make_boss(db_session)

    row = client.get("/api/profit/varieties").json()[0]
    assert row["recommended_price"] == 40.0
    assert row["verdict"] == "good"
    assert row["market_price"] == pytest.approx(40.0)
    assert row["break_even"] > 0

    defaults = client.get(f"/api/profit/defaults?variety_id={row['variety_id']}").json()
    assert defaults["palay_price"] == pytest.approx(20.0)
    assert defaults["recovery_source"] == "default"


def test_the_boss_sets_the_margin_and_the_staff_share(make_auth_client, db_session):
    client = make_auth_client(ALL_FEATURES, role_name="accountant")
    _make_boss(db_session)
    assert client.get("/api/profit/settings").json() == {"target_margin_pct": 10.0, "staff_profit_pct": 30.0}

    saved = client.put("/api/profit/settings", json={"target_margin_pct": 15, "staff_profit_pct": 50})
    assert saved.status_code == 200
    assert saved.json() == {"target_margin_pct": 15.0, "staff_profit_pct": 50.0}

    assert client.put("/api/profit/settings", json={"target_margin_pct": 100}).status_code == 422
    assert client.put("/api/profit/settings", json={"staff_profit_pct": 101}).status_code == 422


def test_a_period_sets_each_goods_sales_against_its_cost(make_auth_client, db_session):
    client = make_auth_client(ALL_FEATURES, role_name="accountant")
    _stock_the_mill(db_session, market_price="40")
    _make_boss(db_session)
    day = _yesterday().isoformat()

    period = client.get(f"/api/profit/period?start={day}&end={day}").json()
    goods = {g["good"]: g for g in period["goods"]}
    assert goods["rice"]["kg_sold"] == pytest.approx(100)
    assert goods["rice"]["sales"] == pytest.approx(4000)
    # No rice bought or milled yet, so no cost to set against it: no profit claimed.
    assert goods["rice"]["cost"] is None
    assert goods["rice"]["profit"] is None
    assert period["overhead"] == 0
