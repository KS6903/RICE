"""Milling, drying, stock and warehouse recipes: each flags the right things,
and conditions that last for days are reported when they start, not daily."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.automations import engine
from app.automations.base import RecipeContext, RecipeProblem
from app.automations.recipes import RECIPES
from app.automations.recipes import stock as stock_recipes
from app.automations.recipes.production import expected_recovery
from app.automations.recipes.stock import rain_windows
from app.models.company import Branch, Company
from app.models.milling import (
    ByproductInventory,
    MilledRiceInventory,
    MillingBatch,
    MillingBatchInput,
    MillingBatchOutput,
)
from app.models.paddy import DryingRecord, PalayInventory, PalayPurchase, PalayPurchaseItem
from app.models.reference import RiceVariety
from app.models.sales import SalesOrder, SalesOrderItem
from app.models.user_location import UserLocation
from app.models.warehouse import Pallet, RiceBatch, WarehouseLayout, WarehouseZone

MANILA = ZoneInfo("Asia/Manila")
NOW = datetime.fromisoformat("2026-09-29T07:05+08:00")
TODAY = date(2026, 9, 29)


def _ctx(db_session, company, *, now=NOW, test=False) -> RecipeContext:
    return RecipeContext(db=db_session, company=company, now=now, zone=MANILA, test=test)


def _build(db_session, company, code, *, now=NOW, test=False, **params):
    recipe = RECIPES[code]
    return recipe.build(_ctx(db_session, company, now=now, test=test), recipe.params(**params))


@pytest.fixture
def company(db_session, seed_owner) -> Company:
    return db_session.get(Company, seed_owner.company_id)


@pytest.fixture
def variety(db_session, company) -> RiceVariety:
    v = RiceVariety(company_id=company.id, code="RC222", name="RC222", typical_recovery_pct=Decimal(65))
    db_session.add(v)
    db_session.flush()
    return v


# ── poor milling batch ───────────────────────────────────────────────────────


def test_expected_recovery_weights_each_variety_and_falls_back_for_unknowns():
    inputs = [(Decimal(1000), Decimal(66)), (Decimal(1000), None)]
    assert expected_recovery(inputs, Decimal(60)) == Decimal(63)
    assert expected_recovery([], Decimal(60)) == Decimal(60)


def _batch(db_session, no, *, input_kg, milled_kg, broken=None, variety=None, ended=NOW - timedelta(hours=1)):
    batch = MillingBatch(batch_no=no, start_datetime=ended - timedelta(hours=6), end_datetime=ended, status="completed")
    db_session.add(batch)
    db_session.flush()
    db_session.add_all(
        [
            MillingBatchInput(batch_id=batch.id, variety_id=variety.id if variety else None, input_weight_kg=input_kg),
            MillingBatchOutput(
                batch_id=batch.id, output_type="milled_rice", output_weight_kg=milled_kg, broken_rice_pct=broken
            ),
        ]
    )
    db_session.flush()
    return batch


def test_low_recovery_and_high_broken_rice_are_flagged(db_session, company, variety):
    _batch(db_session, "MB-LOW", input_kg=1000, milled_kg=590, variety=variety)  # 59% against 65%
    _batch(db_session, "MB-OK", input_kg=1000, milled_kg=640, variety=variety, broken=Decimal(8))
    _batch(db_session, "MB-BROKEN", input_kg=1000, milled_kg=650, variety=variety, broken=Decimal(22))
    _batch(db_session, "MB-OLD", input_kg=1000, milled_kg=400, ended=NOW - timedelta(days=3))
    notices = _build(db_session, company, "milling_quality")
    assert [(n.title, n.body) for n in notices] == [
        (
            "Poor milling batch: MB-LOW",
            "Recovery 59.0%: 590 kg of rice from 1,000 kg of palay. Expected about 65%.",
        ),
        ("Poor milling batch: MB-BROKEN", "Broken rice 22%, over your 15% limit."),
    ]


# ── wet palay and unfinished work ────────────────────────────────────────────


def _wet_item(db_session, ref, *, moisture, hours_ago, dried=False):
    purchase = PalayPurchase(
        reference_no=ref,
        purchase_date=TODAY,
        status="completed",
        created_at=NOW - timedelta(hours=hours_ago),
        updated_at=NOW - timedelta(hours=hours_ago),
    )
    db_session.add(purchase)
    db_session.flush()
    item = PalayPurchaseItem(
        purchase_id=purchase.id,
        gross_weight_kg=Decimal(2010),
        tare_weight_kg=Decimal(10),
        price_per_cavan=Decimal(900),
        moisture_content_pct=Decimal(moisture),
    )
    db_session.add(item)
    db_session.flush()
    if dried:
        db_session.add(DryingRecord(purchase_item_id=item.id, start_datetime=NOW - timedelta(hours=1), drying_cost=0))
        db_session.flush()
    return item


def test_wet_palay_left_undried_is_flagged(db_session, company):
    _wet_item(db_session, "PP-WET", moisture=22, hours_ago=14)
    _wet_item(db_session, "PP-FRESH", moisture=22, hours_ago=3)  # not waiting long yet
    _wet_item(db_session, "PP-DRY", moisture=13, hours_ago=14)  # dry enough
    _wet_item(db_session, "PP-DRYING", moisture=22, hours_ago=14, dried=True)  # being dried
    [notice] = _build(db_session, company, "wet_palay", moisture_over=14, hours=12)
    assert notice.title == "Wet palay waiting to dry: PP-WET"
    assert notice.body.startswith("2,000 kg of palay at 22% moisture from an unnamed supplier, bought 14 hours ago")


def test_batches_and_drying_left_open_are_flagged(db_session, company):
    db_session.add_all(
        [
            MillingBatch(batch_no="MB-OPEN", start_datetime=NOW - timedelta(hours=30), status="in_progress"),
            MillingBatch(batch_no="MB-RUNNING", start_datetime=NOW - timedelta(hours=2), status="in_progress"),
            MillingBatch(batch_no="MB-ANCIENT", start_datetime=NOW - timedelta(days=200), status="in_progress"),
            DryingRecord(start_datetime=NOW - timedelta(hours=72), drying_cost=0),
            DryingRecord(start_datetime=NOW - timedelta(hours=72), end_datetime=NOW, drying_cost=0),
        ]
    )
    db_session.flush()
    titles = [n.title for n in _build(db_session, company, "left_open")]
    assert titles == ["Milling batch still open: MB-OPEN", "Drying not finished"]


# ── low stock, reported once until restocked ─────────────────────────────────


def _sold(db_session, variety, kg_sold, *, grade="Premium"):
    order = SalesOrder(order_no=f"SO-{kg_sold}", order_date=TODAY - timedelta(days=3), status="confirmed")
    db_session.add(order)
    db_session.flush()
    db_session.add(
        SalesOrderItem(
            order_id=order.id,
            item_type="milled_rice",
            variety_id=variety.id,
            grade_name=grade,
            quantity_kg=Decimal(kg_sold),
            unit_price_per_kg=Decimal(50),
        )
    )


def test_low_stock_is_reported_when_it_starts_and_again_after_a_restock(db_session, company, variety):
    stock = MilledRiceInventory(variety_id=variety.id, grade_name="Premium", quantity_kg=Decimal(400))
    db_session.add(stock)
    _sold(db_session, variety, 3000)  # 100 kg a day: 4 days left
    db_session.flush()

    [first] = _build(db_session, company, "low_stock", days=7)
    assert first.title == "Running low: 1 item"
    assert first.body == "RC222 Premium rice: 400 kg left, about 4 days at your usual pace"
    # The next morning it's still low: nothing new to say.
    assert _build(db_session, company, "low_stock", now=NOW + timedelta(days=1), days=7) == []
    # A test always shows the current state, and doesn't change what's remembered.
    assert len(_build(db_session, company, "low_stock", test=True, days=7)) == 1

    stock.quantity_kg = Decimal(5000)  # restocked
    db_session.flush()
    assert _build(db_session, company, "low_stock", now=NOW + timedelta(days=2), days=7) == []
    stock.quantity_kg = Decimal(300)  # and low again
    db_session.flush()
    assert len(_build(db_session, company, "low_stock", now=NOW + timedelta(days=3), days=7)) == 1


def test_palay_cover_counts_what_milling_used(db_session, company, variety):
    db_session.add(PalayInventory(variety_id=variety.id, quantity_kg=Decimal(2000)))
    batch = MillingBatch(batch_no="MB-1", start_datetime=NOW - timedelta(days=5), status="completed")
    db_session.add(batch)
    db_session.flush()
    db_session.add(MillingBatchInput(batch_id=batch.id, variety_id=variety.id, input_weight_kg=Decimal(15000)))
    db_session.flush()
    [notice] = _build(db_session, company, "low_stock", days=7)
    assert notice.body == "RC222 palay: 2,000 kg left, about 4 days of milling"


# ── warehouse ────────────────────────────────────────────────────────────────


@pytest.fixture
def layout(db_session, company, seed_owner) -> WarehouseLayout:
    layout = WarehouseLayout(
        branch_id=seed_owner.branch_id,
        company_id=company.id,
        name="Main warehouse",
        width_m=Decimal(40),
        height_m=Decimal(20),
        grid_size_m=Decimal(1),
    )
    db_session.add(layout)
    db_session.flush()
    return layout


def _pallet(db_session, company, layout, code, *, weight, zone=None, status="in_storage") -> Pallet:
    pallet = Pallet(
        company_id=company.id,
        layout_id=layout.id,
        zone_id=zone.id if zone else None,
        pallet_code=code,
        x_m=Decimal(1),
        y_m=Decimal(1),
        z_layer=0,
        width_m=Decimal("1.2"),
        depth_m=Decimal("1.0"),
        sack_count=40,
        weight_kg=Decimal(weight),
        status=status,
    )
    db_session.add(pallet)
    db_session.flush()
    return pallet


def test_old_rice_is_reported_near_and_again_past_best_before(db_session, company, layout, variety):
    pallet = _pallet(db_session, company, layout, "P-001", weight=2000)
    batch = RiceBatch(
        company_id=company.id,
        pallet_id=pallet.id,
        variety_id=variety.id,
        sack_count=40,
        weight_kg=Decimal(2000),
        milling_date=TODAY - timedelta(days=170),
        best_before_date=TODAY + timedelta(days=10),
    )
    fresh = RiceBatch(
        company_id=company.id,
        pallet_id=pallet.id,
        sack_count=10,
        weight_kg=Decimal(500),
        milling_date=TODAY,
        best_before_date=TODAY + timedelta(days=180),
    )
    db_session.add_all([batch, fresh])
    db_session.flush()

    [soon] = _build(db_session, company, "shelf_life", warn_days=14)
    assert soon.title == "Rice getting old: 1 batch nearly there"
    assert soon.body.splitlines()[0] == "Pallet P-001: RC222, 40 sacks, best before 09 Oct"
    assert _build(db_session, company, "shelf_life", now=NOW + timedelta(days=1), warn_days=14) == []
    [past] = _build(db_session, company, "shelf_life", now=NOW + timedelta(days=12), warn_days=14)
    assert past.title == "Rice getting old: 1 batch past best-before"
    assert past.body.splitlines()[0] == "Pallet P-001: RC222, 40 sacks, 2 days past best-before"


def test_a_zone_over_its_weight_limit_is_flagged(db_session, company, layout):
    def zone(name, limit):
        z = WarehouseZone(
            layout_id=layout.id,
            zone_type="storage",
            name=name,
            x_m=Decimal(0),
            y_m=Decimal(0),
            width_m=Decimal(5),
            height_m=Decimal(5),
            rotation_deg=Decimal(0),
            max_weight_kg=Decimal(limit) if limit else None,
            color_hex="#10b981",
        )
        db_session.add(z)
        db_session.flush()
        return z

    a1, a2, a3 = zone("A1", 3000), zone("A2", 10000), zone("A3", None)
    for i in range(2):
        _pallet(db_session, company, layout, f"A1-{i}", weight=2000, zone=a1)
    _pallet(db_session, company, layout, "A1-gone", weight=9000, zone=a1, status="dispatched")
    _pallet(db_session, company, layout, "A2-0", weight=2000, zone=a2)
    _pallet(db_session, company, layout, "A3-0", weight=99000, zone=a3)
    [notice] = _build(db_session, company, "zone_overweight")
    assert notice.title == "Warehouse zone over its limit: 1 zone"
    assert notice.body.splitlines()[0] == "A1 (Main warehouse): 4,000 kg on a 3,000 kg limit (133%)"


def test_stock_below_zero_is_flagged_once(db_session, company, variety, seed_owner):
    db_session.add_all(
        [
            MilledRiceInventory(variety_id=variety.id, grade_name="Premium", quantity_kg=Decimal(-250)),
            PalayInventory(variety_id=variety.id, quantity_kg=Decimal(100)),
            ByproductInventory(byproduct_type="rice_bran", quantity_kg=Decimal(-40)),
        ]
    )
    db_session.flush()
    [notice] = _build(db_session, company, "negative_stock")
    assert notice.body.splitlines()[:2] == ["Rice bran: -40 kg", "RC222 Premium rice: -250 kg"]
    assert _build(db_session, company, "negative_stock", now=NOW + timedelta(days=1)) == []


# ── rain ─────────────────────────────────────────────────────────────────────


def _hour(hh: int, pct: int, day: str = "2026-09-29") -> dict:
    return {"time": f"{day}T{hh:02d}:00", "precip_pct": pct, "is_daytime": 6 <= hh < 18}


def test_rain_windows_join_neighbouring_hours():
    hourly = [_hour(7, 10), _hour(13, 70), _hour(14, 85), _hour(15, 65), _hour(16, 20), _hour(19, 90)]
    hourly.append(_hour(9, 95, day="2026-09-30"))  # tomorrow
    assert rain_windows(hourly, TODAY, 60) == [(13, 15, 85)]


def test_rain_warning_uses_a_saved_location(db_session, company, seed_owner, monkeypatch):
    with pytest.raises(RecipeProblem, match="No saved location"):
        _build(db_session, company, "rain_warning")
    loc = UserLocation(user_id=seed_owner.id, label="Cabanatuan", lat=Decimal("15.49"), lon=Decimal("120.97"))
    db_session.add(loc)
    db_session.flush()
    asked = []

    def fake_forecast(lat, lon):
        asked.append((lat, lon))
        return {"hourly": [_hour(13, 70), _hour(14, 80)]}

    monkeypatch.setattr(stock_recipes, "_forecast", fake_forecast)
    [notice] = _build(db_session, company, "rain_warning", location_id=str(loc.id), chance=60)
    assert asked == [(15.49, 120.97)]
    assert notice.title == "Rain likely today at Cabanatuan"
    assert notice.body == (
        "Rain expected 13:00 to 15:00 (up to 80%). Don't spread palay to dry, or bring it in before 13:00."
    )
    with pytest.raises(RecipeProblem, match="was deleted"):
        _build(db_session, company, "rain_warning", location_id="00000000-0000-0000-0000-000000000000")


def test_the_page_lists_the_mills_saved_locations(auth_client, db_session, seed_owner):
    db_session.add(UserLocation(user_id=seed_owner.id, label="Cabanatuan", lat=Decimal(15), lon=Decimal(121)))
    db_session.flush()
    rain = next(r for r in auth_client.get("/api/automations/").json()["recipes"] if r["code"] == "rain_warning")
    [where] = [f for f in rain["fields"] if f["name"] == "location_id"]
    assert [o["label"] for o in where["options"]] == ["The first saved location", "Cabanatuan"]


def test_a_test_send_explains_a_setup_problem(auth_client):
    res = auth_client.post("/api/automations/rain_warning/test")
    assert res.status_code == 400
    assert "No saved location" in res.json()["detail"]


def test_a_setup_problem_is_recorded_as_the_runs_failure(db_session, company):
    from app.jobs.registry import JobContext
    from app.models.automation import AutomationRule
    from app.models.job_run import JobRun

    db_session.add(AutomationRule(company_id=company.id, recipe="rain_warning", enabled=True, params={}, recipients=[]))
    db_session.commit()
    now = datetime.fromisoformat("2026-09-29T05:10+08:00")
    summary = engine.run_due_automations(JobContext(db=db_session, now=now, zone=MANILA, run_key="t", company=company))
    assert summary == "0 automation(s) ran, 1 failed"
    run = db_session.query(JobRun).filter(JobRun.job == "automation.rain_warning").one()
    assert run.detail.startswith("No saved location yet")


def test_branch_names_show_only_for_multi_branch_mills(db_session, company, variety, seed_owner):
    second = Branch(company_id=company.id, name="Gapan")
    db_session.add(second)
    db_session.flush()
    db_session.add(MilledRiceInventory(branch_id=second.id, variety_id=variety.id, quantity_kg=Decimal(-5)))
    db_session.flush()
    [notice] = _build(db_session, company, "negative_stock")
    assert notice.body.splitlines()[0] == "RC222 rice: -5 kg at Gapan"
