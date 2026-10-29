"""The default varieties: what a new mill starts with, and how a mill made before
the lists changed (NSIC Rc222 and the rest, one list for palay and rice) is brought
to them."""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.core.tenancy import sync_system_varieties
from app.models.milling import MillingBatch, MillingBatchInput
from app.models.paddy import PalayInventory, PalayPurchase, PalayPurchaseItem
from app.models.reference import RiceVariety
from app.models.sales import SalesOrder, SalesOrderItem

# The retired default each current default replaces.
OLD = {
    "Dinorado": ("Rc222", "NSIC Rc222"),
    "Jasmine Rice": ("Rc216", "NSIC Rc216"),
    "Sinandomeng": ("Rc218", "NSIC Rc218"),
    "Maharlika": ("Rc298", "NSIC Rc298"),
    "Brown Rice": ("PSB14", "PSB Rc14"),
    "Red Rice": ("SINAG", "Sinag (Hybrid)"),
    "Black Rice": ("MESTIZO", "Mestizo (Hybrid)"),
    "Malagkit": ("LOCAL", "Local Variety"),
}


@pytest.fixture(autouse=True)
def _no_autoflush(db_session, seed_owner):
    """migrate_all_tenants.py runs on a session that doesn't autoflush; so do these."""
    db_session.autoflush = False


def _defaults(db, kind="rice"):
    return db.query(RiceVariety).filter(RiceVariety.company_id.is_(None), RiceVariety.kind == kind).all()


def _go_back(db, code):
    """Make the default `code` look like the schema of a mill made before the list changed."""
    old_code, old_name = OLD[code]
    row = db.query(RiceVariety).filter_by(code=code, company_id=None).one()
    row.code, row.name, row.category, row.typical_recovery_pct = old_code, old_name, "inbred", 66
    db.flush()
    return row


def test_an_old_default_is_renamed_in_place(db_session, seed_owner):
    row = _go_back(db_session, "Dinorado")
    row_id = row.id

    sync_system_varieties(db_session)

    assert (row.id, row.code, row.name) == (row_id, "Dinorado", "Dinorado")
    assert row.category is None
    assert float(row.typical_recovery_pct) == 65
    assert len(_defaults(db_session)) == 8


def test_every_old_default_becomes_its_replacement(db_session, seed_owner):
    ids = {code: _go_back(db_session, code).id for code in OLD}

    sync_system_varieties(db_session)

    now = {v.id: v for v in _defaults(db_session)}
    assert {code: now[row_id].code for code, row_id in ids.items()} == {code: code for code in OLD}
    assert now[ids["Malagkit"]].name == "Malagkit (Glutinous Rice | Sticky Rice)"
    assert now[ids["Brown Rice"]].name == "Brown Rice (Unpolished Rice)"
    assert len(now) == 8


def test_syncing_again_changes_nothing_and_never_adds_back_a_renamed_default(db_session, seed_owner):
    _go_back(db_session, "Dinorado")
    sync_system_varieties(db_session)
    dinorado = db_session.query(RiceVariety).filter_by(code="Dinorado", company_id=None).one()
    dinorado.code = "TUBIGAN"
    db_session.flush()

    sync_system_varieties(db_session)

    codes = sorted(v.code for v in _defaults(db_session))
    assert "Dinorado" not in codes
    assert "TUBIGAN" in codes
    assert len(codes) == 8


def test_an_old_default_is_hidden_when_the_mill_already_made_its_own_with_the_new_code(db_session, seed_owner):
    old = _go_back(db_session, "Dinorado")
    mine = RiceVariety(company_id=seed_owner.company_id, code="dinorado", name="My Dinorado")
    db_session.add(mine)
    db_session.flush()

    sync_system_varieties(db_session)

    assert old.code == "Rc222"
    assert old.is_active is False
    assert old.deactivated_at is not None
    assert mine.is_active is True


# ── the palay list ───────────────────────────────────────────────────────────


def _palay_records_on(db, owner, rice_row):
    """One of each kind of palay record, all pointing at a rice default."""
    purchase = PalayPurchase(
        company_id=owner.company_id, reference_no="PP-T-1", purchase_date=date(2026, 10, 1), status="completed"
    )
    batch = MillingBatch(company_id=owner.company_id, batch_no="MB-T-1", start_datetime=datetime.now(timezone.utc))
    order = SalesOrder(company_id=owner.company_id, order_no="SO-T-1", order_date=date(2026, 10, 1))
    db.add_all([purchase, batch, order])
    db.flush()
    records = [
        PalayInventory(company_id=owner.company_id, variety_id=rice_row.id, quantity_kg=Decimal("500")),
        PalayPurchaseItem(
            purchase_id=purchase.id,
            variety_id=rice_row.id,
            gross_weight_kg=Decimal("500"),
            price_per_cavan=Decimal("1000"),
        ),
        MillingBatchInput(batch_id=batch.id, variety_id=rice_row.id, input_weight_kg=Decimal("500")),
        SalesOrderItem(
            order_id=order.id,
            item_type="palay",
            variety_id=rice_row.id,
            quantity_kg=Decimal("50"),
            unit_price_per_kg=Decimal("20"),
        ),
        SalesOrderItem(
            order_id=order.id,
            item_type="milled_rice",
            variety_id=rice_row.id,
            quantity_kg=Decimal("50"),
            unit_price_per_kg=Decimal("50"),
        ),
    ]
    db.add_all(records)
    db.flush()
    return records


def _go_back_to_one_list(db):
    """Make the schema look like a mill made before palay had a list of its own."""
    db.query(RiceVariety).filter(RiceVariety.kind == "palay").delete()
    db.flush()


def test_a_new_mill_has_both_lists(db_session, seed_owner):
    assert len(_defaults(db_session, "rice")) == 8
    palay = _defaults(db_session, "palay")
    assert len(palay) == 33
    assert {v.category for v in palay} == {"inbred", "hybrid"}


def test_an_older_mill_gets_the_palay_list_and_its_palay_records_move_to_it(db_session, seed_owner):
    dinorado = db_session.query(RiceVariety).filter_by(code="Dinorado", company_id=None).one()
    palay_inv, item, batch_input, palay_sale, rice_sale = _palay_records_on(db_session, seed_owner, dinorado)
    _go_back_to_one_list(db_session)
    assert _defaults(db_session, "palay") == []

    sync_system_varieties(db_session)

    rc222 = db_session.query(RiceVariety).filter_by(code="NSIC Rc 222", company_id=None).one()
    assert len(_defaults(db_session, "palay")) == 33
    assert rc222.kind == "palay"
    assert palay_inv.variety_id == item.variety_id == batch_input.variety_id == palay_sale.variety_id == rc222.id
    # What is sold as rice, and the rice default itself, stay as they were.
    assert rice_sale.variety_id == dinorado.id
    assert dinorado.kind == "rice"
    assert len(_defaults(db_session, "rice")) == 8


def test_the_palay_list_arrives_once_and_a_hidden_default_is_not_added_back(db_session, seed_owner):
    dinorado = db_session.query(RiceVariety).filter_by(code="Dinorado", company_id=None).one()
    _go_back_to_one_list(db_session)
    sync_system_varieties(db_session)
    rc222 = db_session.query(RiceVariety).filter_by(code="NSIC Rc 222", company_id=None).one()
    rc222.is_active = False
    later = _palay_records_on(db_session, seed_owner, dinorado)[0]

    sync_system_varieties(db_session)

    assert len(_defaults(db_session, "palay")) == 33
    assert db_session.get(RiceVariety, rc222.id).is_active is False
    # A palay record that uses a rice variety later was put there on purpose.
    assert later.variety_id == dinorado.id
