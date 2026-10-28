"""The default rice varieties: what a new mill starts with, and how a mill made
before the list changed (NSIC Rc222 and the rest) is brought to it."""

import pytest
from app.core.tenancy import sync_system_varieties
from app.models.reference import RiceVariety

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


def _defaults(db):
    return db.query(RiceVariety).filter(RiceVariety.company_id.is_(None)).all()


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
