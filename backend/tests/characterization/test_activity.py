"""Characterization: the activity-log read endpoint (Phase 3b target)."""

from app.models.activity import ActivityLog


def test_activity_empty_is_list(auth_client):
    res = auth_client.get("/api/activity/")
    assert res.status_code == 200
    assert res.json() == []


def test_activity_serialized_shape(auth_client, seed_owner, db_session):
    db_session.add(
        ActivityLog(
            company_id=seed_owner.company_id,
            user_id=seed_owner.id,
            action="warehouse.delete",
            entity_type="branch",
            entity_label="Main Branch",
            detail="Moved to trash.",
        )
    )
    db_session.flush()

    res = auth_client.get("/api/activity/")
    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == 1
    row = rows[0]
    assert set(row.keys()) == {"id", "action", "user_name", "entity_type", "entity_label", "detail", "created_at"}
    assert row["action"] == "warehouse.delete"
    assert row["entity_label"] == "Main Branch"
    assert row["user_name"] == seed_owner.full_name


def test_activity_requires_management_role(make_auth_client):
    # A cashier (non owner/admin) must be blocked by require_roles.
    c = make_auth_client(features=["inventory"], username="cash", role_name="cashier")
    res = c.get("/api/activity/")
    assert res.status_code == 403
