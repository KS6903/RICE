"""Machine servicing: use since the last service, from the milling done, against
the manufacturer's intervals; reported once when due soon and once when due,
and counted again from a recorded service."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.automations.base import RecipeContext
from app.automations.recipes import RECIPES
from app.models.company import Company
from app.models.maintenance import Equipment
from app.models.milling import MillingBatch, MillingBatchInput

MANILA = ZoneInfo("Asia/Manila")
NOW = datetime.fromisoformat("2026-09-29T07:05+08:00")
TODAY = date(2026, 9, 29)


@pytest.fixture
def company(db_session, seed_owner) -> Company:
    return db_session.get(Company, seed_owner.company_id)


def _batch(db_session, no, *, start, hours, kilos, status="completed"):
    batch = MillingBatch(batch_no=no, start_datetime=start, end_datetime=start + timedelta(hours=hours), status=status)
    db_session.add(batch)
    db_session.flush()
    db_session.add(MillingBatchInput(batch_id=batch.id, input_weight_kg=Decimal(kilos)))
    db_session.flush()


def _huller(db_session, company, **intervals) -> Equipment:
    e = Equipment(company_id=company.id, name="Rubber-roll huller", last_service_on=date(2026, 9, 1), **intervals)
    db_session.add(e)
    db_session.flush()
    return e


def _build(db_session, company, now=NOW):
    recipe = RECIPES["maintenance_due"]
    return recipe.build(RecipeContext(db=db_session, company=company, now=now, zone=MANILA), recipe.params())


def test_use_since_the_last_service_comes_from_the_milling(db_session, company):
    huller = _huller(db_session, company, every_hours=100, every_tonnes=Decimal(500), every_days=90)
    at = datetime(2026, 9, 10, 8, 0, tzinfo=MANILA)
    _batch(db_session, "MB-1", start=at, hours=8, kilos=40_000)
    _batch(db_session, "MB-2", start=at + timedelta(days=1), hours=10, kilos=60_000)
    _batch(db_session, "MB-0", start=datetime(2026, 8, 20, 8, 0, tzinfo=MANILA), hours=50, kilos=1)  # before
    _batch(db_session, "MB-X", start=at, hours=50, kilos=1, status="cancelled")
    from app.automations.maintenance import usage

    use = usage(db_session, huller, TODAY, MANILA)
    assert (use.hours, use.tonnes, use.days) == (Decimal(18), Decimal(100), 28)
    assert use.status(huller) == "ok"


def test_a_machine_is_reported_due_soon_then_due_and_quiet_after_its_service(auth_client, db_session, company):
    huller = _huller(db_session, company, every_hours=20)
    at = datetime(2026, 9, 10, 8, 0, tzinfo=MANILA)
    _batch(db_session, "MB-1", start=at, hours=18, kilos=1_000)  # 90%: due soon
    [notice] = _build(db_session, company)
    assert notice.title == "Machine servicing: 1 machine due soon"
    assert notice.body.splitlines()[0] == "Rubber-roll huller: due soon, 18 of 20 running hours since 01 Sep"
    assert _build(db_session, company, now=NOW + timedelta(days=1)) == []  # said once

    _batch(db_session, "MB-2", start=at + timedelta(days=2), hours=4, kilos=1_000)  # 22 hours: due
    [notice] = _build(db_session, company, now=NOW + timedelta(days=2))
    assert notice.title == "Machine servicing: 1 machine due"
    db_session.commit()

    res = auth_client.post(f"/api/equipment/{huller.id}/service", json={"done_on": "2026-09-28", "note": "New rolls."})
    assert res.status_code == 200, res.text
    assert res.json()["last_service_on"] == "2026-09-28"
    assert _build(db_session, company, now=NOW + timedelta(days=3)) == []
    log = auth_client.get(f"/api/equipment/{huller.id}/log").json()["log"]
    assert (log[0]["note"], log[0]["done_by"]) == ("New rolls.", "Test Owner")


def test_a_machine_needs_an_interval(auth_client):
    res = auth_client.post("/api/equipment/", json={"name": "Polisher", "last_service_on": "2026-09-01"})
    assert res.status_code == 422
    res = auth_client.post(
        "/api/equipment/", json={"name": "Polisher", "last_service_on": "2026-09-01", "every_days": 30}
    )
    assert res.status_code == 201 and res.json()["status"] in ("ok", "soon", "due")


def test_maintenance_needs_enterprise_and_milling_access(make_auth_client):
    assert make_auth_client(features=["milling"], username="pro").get("/api/equipment/").status_code == 402
    till = make_auth_client(features=["automations"], username="till", role_name="cashier")
    assert till.get("/api/equipment/").status_code == 403
