"""Stock counts: the floor against the records, counted blind; lines out by
more than the allowance reach the owner and wait for review."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.automations.base import RecipeContext
from app.automations.recipes import RECIPES
from app.models.automation import AutomationRule
from app.models.company import Company
from app.models.milling import ByproductInventory, MilledRiceInventory
from app.models.notification import Notification
from app.models.reference import RiceVariety
from app.models.stock_count import StockCount

MANILA = ZoneInfo("Asia/Manila")


@pytest.fixture
def company(db_session, seed_owner) -> Company:
    return db_session.get(Company, seed_owner.company_id)


@pytest.fixture
def stock(db_session, company):
    variety = RiceVariety(company_id=company.id, code="RC222", name="NSIC Rc222")
    db_session.add(variety)
    db_session.flush()
    rice = MilledRiceInventory(
        company_id=company.id, variety_id=variety.id, grade_name="Premium", quantity_kg=Decimal(5000)
    )
    bran = ByproductInventory(company_id=company.id, byproduct_type="darak", quantity_kg=Decimal(800))
    db_session.add_all([rice, bran])
    db_session.commit()
    return rice, bran


def _guard(db_session, company, tolerance_pct=2):
    db_session.add(
        AutomationRule(
            company_id=company.id,
            recipe="stock_count",
            enabled=True,
            params={"tolerance_pct": tolerance_pct},
            recipients=[],
        )
    )
    db_session.commit()


def test_the_sheet_is_blind_and_a_short_line_reaches_the_owner(auth_client, db_session, company, seed_owner, stock):
    rice, bran = stock
    _guard(db_session, company)
    page = auth_client.get("/api/stock-counts/").json()
    assert [line["label"] for line in page["sheet"]] == ["By-product, darak", "Milled rice, NSIC Rc222 (grade Premium)"]
    assert all("recorded_kg" not in line for line in page["sheet"])

    res = auth_client.post(
        "/api/stock-counts/",
        json={
            "lines": [
                {"kind": "milled_rice", "inventory_id": str(rice.id), "counted_kg": "4700"},  # 6% short
                {"kind": "byproduct", "inventory_id": str(bran.id), "counted_kg": "795"},  # within 2%
            ],
            "note": "Bodega 2 counted twice.",
        },
    )
    assert res.status_code == 201, res.text
    count = res.json()
    assert count["needs_review"] is True
    rice_line = next(line for line in count["lines"] if line["label"].startswith("Milled rice"))
    assert (rice_line["recorded_kg"], rice_line["difference_kg"], rice_line["out"]) == (5000, -300, True)

    db_session.expire_all()
    [notice] = db_session.query(Notification).all()
    assert notice.title.endswith(": 1 line out")
    assert (
        "Milled rice, NSIC Rc222 (grade Premium): counted 4,700 kg, records say 5,000 kg (short 300 kg)" in notice.body
    )
    # The count changes no stock.
    assert db_session.get(MilledRiceInventory, rice.id).quantity_kg == Decimal(5000)

    res = auth_client.post(f"/api/stock-counts/{count['id']}/review", json={"note": "Spillage in bodega 2."})
    assert res.json()["needs_review"] is False


def test_lines_not_on_the_sheet_are_refused(auth_client, stock):
    import uuid

    res = auth_client.post(
        "/api/stock-counts/",
        json={"lines": [{"kind": "palay", "inventory_id": str(uuid.uuid4()), "counted_kg": "10"}]},
    )
    assert res.status_code == 400


def test_the_reminder_comes_when_the_stock_wasnt_counted_lately(db_session, company, seed_owner, stock):
    recipe = RECIPES["stock_count"]
    ctx = RecipeContext(db=db_session, company=company, now=datetime.now(MANILA), zone=MANILA)
    [notice] = recipe.build(ctx, recipe.params(every="month"))
    assert notice.title == "Time to count the stock"
    db_session.add(StockCount(company_id=company.id, count_date=ctx.local_today, counted_by=seed_owner.id))
    db_session.flush()
    assert recipe.build(ctx, recipe.params(every="month")) == []


def test_stock_counts_need_enterprise_and_inventory_access(make_auth_client):
    assert make_auth_client(features=["inventory"], username="pro").get("/api/stock-counts/").status_code == 402
    till = make_auth_client(features=["automations"], username="enc", role_name="encoder")
    assert till.get("/api/stock-counts/").status_code == 200  # encoders see inventory
    assert till.post("/api/stock-counts/", json={"lines": []}).status_code in (403, 422)
