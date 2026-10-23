"""Characterization: the activity log shows a date range, the last month by default."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.models.activity import ActivityLog

MANILA = ZoneInfo("Asia/Manila")  # the seeded company's time zone (the model default)


def _log(db_session, owner, label: str, days_ago: int) -> None:
    db_session.add(
        ActivityLog(
            company_id=owner.company_id,
            user_id=owner.id,
            action="warehouse.delete",
            entity_type="branch",
            entity_label=label,
            created_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
        )
    )
    db_session.flush()


def _labels(client, **params) -> list[str]:
    res = client.get("/api/activity/", params=params)
    assert res.status_code == 200, res.text
    return [r["entity_label"] for r in res.json()]


def test_the_log_shows_the_last_month_unless_asked(auth_client, db_session, seed_owner):
    _log(db_session, seed_owner, "recent", days_ago=2)
    _log(db_session, seed_owner, "old", days_ago=40)
    assert _labels(auth_client) == ["recent"]


def test_a_chosen_range_shows_older_activity(auth_client, db_session, seed_owner):
    _log(db_session, seed_owner, "recent", days_ago=2)
    _log(db_session, seed_owner, "old", days_ago=40)
    today = datetime.now(MANILA).date()
    window = {"start": str(today - timedelta(days=45)), "end": str(today - timedelta(days=35))}
    assert _labels(auth_client, **window) == ["old"]


def test_a_range_covers_31_days_at_most(auth_client):
    today = datetime.now(MANILA).date()
    ok = {"start": str(today - timedelta(days=30)), "end": str(today)}
    assert auth_client.get("/api/activity/", params=ok).status_code == 200
    too_long = {"start": str(today - timedelta(days=31)), "end": str(today)}
    res = auth_client.get("/api/activity/", params=too_long)
    assert res.status_code == 422
    assert "31 days" in res.json()["detail"]


def test_the_start_must_not_be_after_the_end(auth_client):
    today = datetime.now(MANILA).date()
    res = auth_client.get("/api/activity/", params={"start": str(today), "end": str(today - timedelta(days=1))})
    assert res.status_code == 422
