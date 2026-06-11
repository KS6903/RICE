"""Characterization: auto-delete of deactivated rice varieties after 30 days.

The background task in main.py delegates to purge_stale_varieties(db). These
tests call that function directly with the isolated test session so we don't
have to wait 24 hours or fight asyncio.
"""
from datetime import datetime, timedelta, timezone

from app.models.reference import RiceVariety
from app.services.paddy_service import purge_stale_varieties

# ── helpers ───────────────────────────────────────────────────────────────────

def _create_variety(c, code="PURGE1"):
    res = c.post("/api/paddy/varieties", json={"code": code, "name": f"Variety {code}"})
    assert res.status_code == 201, res.text
    return res.json()


def _deactivate(c, variety_id: str):
    res = c.put(f"/api/paddy/varieties/{variety_id}", json={"is_active": False})
    assert res.status_code == 200, res.text
    return res.json()


def _backdate(db_session, variety_id: str, days: int):
    """Set deactivated_at to *days* days ago directly on the DB row."""
    v = db_session.query(RiceVariety).filter(RiceVariety.id == variety_id).one()
    v.deactivated_at = datetime.now(timezone.utc) - timedelta(days=days)
    db_session.flush()


# ── tests ─────────────────────────────────────────────────────────────────────

def test_purge_deletes_variety_deactivated_over_30_days(auth_client, db_session):
    v = _create_variety(auth_client, "OLD1")
    _deactivate(auth_client, v["id"])
    _backdate(db_session, v["id"], days=31)

    deleted = purge_stale_varieties(db_session)

    assert deleted == 1
    still_there = db_session.query(RiceVariety).filter(RiceVariety.id == v["id"]).first()
    assert still_there is None


def test_purge_spares_variety_deactivated_under_30_days(auth_client, db_session):
    v = _create_variety(auth_client, "NEW1")
    _deactivate(auth_client, v["id"])
    _backdate(db_session, v["id"], days=10)

    deleted = purge_stale_varieties(db_session)

    assert deleted == 0
    still_there = db_session.query(RiceVariety).filter(RiceVariety.id == v["id"]).first()
    assert still_there is not None


def test_purge_spares_active_variety_regardless_of_age(auth_client, db_session):
    v = _create_variety(auth_client, "ACTIVE1")
    # never deactivated — deactivated_at stays NULL

    deleted = purge_stale_varieties(db_session)

    assert deleted == 0
    still_there = db_session.query(RiceVariety).filter(RiceVariety.id == v["id"]).first()
    assert still_there is not None


def test_purge_spares_system_variety_deactivated_over_30_days(db_session, seed_owner):
    """System varieties (company_id IS NULL) must never be auto-deleted."""
    system_v = RiceVariety(
        company_id=None,
        code="SYS1",
        name="System Variety",
        is_active=False,
        deactivated_at=datetime.now(timezone.utc) - timedelta(days=60),
    )
    db_session.add(system_v)
    db_session.flush()

    deleted = purge_stale_varieties(db_session)

    assert deleted == 0
    still_there = db_session.query(RiceVariety).filter(RiceVariety.id == system_v.id).first()
    assert still_there is not None


def test_purge_only_deletes_eligible_rows(auth_client, db_session):
    """Mix: one old deactivated (deleted), one recent, one active — only one goes."""
    old = _create_variety(auth_client, "MIX_OLD")
    recent = _create_variety(auth_client, "MIX_RECENT")
    active = _create_variety(auth_client, "MIX_ACTIVE")

    _deactivate(auth_client, old["id"])
    _deactivate(auth_client, recent["id"])
    _backdate(db_session, old["id"], days=45)
    _backdate(db_session, recent["id"], days=5)

    deleted = purge_stale_varieties(db_session)

    assert deleted == 1
    assert db_session.query(RiceVariety).filter(RiceVariety.id == old["id"]).first() is None
    assert db_session.query(RiceVariety).filter(RiceVariety.id == recent["id"]).first() is not None
    assert db_session.query(RiceVariety).filter(RiceVariety.id == active["id"]).first() is not None


def test_deactivate_stamps_deactivated_at(auth_client, db_session):
    """update_variety must set deactivated_at when is_active flips to False."""
    v = _create_variety(auth_client, "STAMP1")
    before = datetime.now(timezone.utc)

    _deactivate(auth_client, v["id"])

    row = db_session.query(RiceVariety).filter(RiceVariety.id == v["id"]).one()
    assert row.deactivated_at is not None
    assert row.deactivated_at >= before


def test_reactivate_clears_deactivated_at(auth_client, db_session):
    """Re-activating a variety must clear deactivated_at so the timer resets."""
    v = _create_variety(auth_client, "REACTIVE1")
    _deactivate(auth_client, v["id"])

    res = auth_client.put(f"/api/paddy/varieties/{v['id']}", json={"is_active": True})
    assert res.status_code == 200

    row = db_session.query(RiceVariety).filter(RiceVariety.id == v["id"]).one()
    assert row.deactivated_at is None
