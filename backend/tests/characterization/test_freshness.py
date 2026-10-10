"""Work entered on a desktop app while offline isn't in the web app's figures:
the owner is told how much, which desktop apps have gone quiet, and the
summaries say what they leave out."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.automations.base import RecipeContext
from app.automations.recipes import RECIPES
from app.models.company import Company
from app.models.sync import SyncConflict, SyncLog

MANILA = ZoneInfo("Asia/Manila")
NOW = datetime.fromisoformat("2026-09-29T07:05+08:00")
YESTERDAY = date(2026, 9, 28)


@pytest.fixture
def company(db_session, seed_owner) -> Company:
    return db_session.get(Company, seed_owner.company_id)


def _synced(db_session, company, table, payload, *, client="electron-a1b2c3", at=NOW, op="INSERT"):
    db_session.add(
        SyncLog(
            company_id=company.id,
            table_name=table,
            record_id=uuid.uuid4(),
            operation=op,
            payload=payload,
            client_id=client,
            synced_at=at,
        )
    )
    db_session.flush()


def _build(db_session, company, code):
    recipe = RECIPES[code]
    return recipe.build(RecipeContext(db=db_session, company=company, now=NOW, zone=MANILA), recipe.params())


def test_the_owner_hears_what_was_entered_offline_and_which_desktop_went_quiet(db_session, company):
    _synced(db_session, company, "palay_purchases", {"purchase_date": "2026-09-28"})
    _synced(db_session, company, "palay_purchases", {"purchase_date": "2026-09-28"})
    _synced(db_session, company, "sales_orders", {"order_date": "2026-09-28"})
    _synced(db_session, company, "sales_orders", {"order_date": "2026-09-20"})  # another day
    _synced(db_session, company, "sales_orders", {"order_date": "2026-09-28"}, op="UPDATE")  # not new
    _synced(db_session, company, "palay_inventory", {"quantity_kg": 5})  # no money of its own
    _synced(
        db_session,
        company,
        "expenses",
        {"expense_date": "2026-09-01"},
        client="electron-ffff99",
        at=NOW - timedelta(days=3),
    )
    db_session.add(SyncConflict(company_id=company.id, table_name="sales_orders", record_id=uuid.uuid4()))
    db_session.flush()

    [notice] = _build(db_session, company, "offline_data")
    assert notice.body.splitlines() == [
        "Entered offline for yesterday: 2 palay purchases, 1 sales order. They're on the desktop apps, "
        "not in the web app's figures, reports or these automations.",
        "The desktop app …ffff99 hasn't synced since Sat 26 Sep, 07:05. "
        "Anything entered on it since is only on that computer.",
        "1 sync conflict waiting to be settled on a desktop app.",
    ]


def test_nothing_offline_nothing_said(db_session, company):
    _synced(db_session, company, "sales_orders", {"order_date": "2026-09-28"}, op="UPDATE")
    assert _build(db_session, company, "offline_data") == []


def test_the_morning_summary_says_what_it_leaves_out(db_session, company):
    _synced(db_session, company, "payments", {"payment_date": YESTERDAY.isoformat()})
    [notice] = _build(db_session, company, "owner_digest")
    assert notice.body.splitlines()[-1] == (
        "Not in these figures: 1 payment entered on the desktop app while offline. Check them there."
    )
