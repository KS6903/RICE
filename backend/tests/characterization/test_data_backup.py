"""The owner's backup file, and loading it into a new account: a file only we
can read, tied to the owner's email; loaded only into an empty account with a
new username and password and room on its plan; moved wholly onto that account,
all or nothing, and never touching anyone else's."""

from __future__ import annotations

import io
import json
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.core.config import settings
from app.core.security import get_current_user, hash_password
from app.core.tenancy import provision_tenant, set_search_path
from app.main import app
from app.models.automation import AutomationState
from app.models.company import Branch, Company
from app.models.employee import Employee
from app.models.subscription import Subscription, SubscriptionPlan
from app.models.supplier_customer import Customer
from app.models.user import User
from app.models.warehouse import Pallet, WarehouseLayout
from app.services import data_backup, platform_emails
from tests import conftest

EMAIL = "owner@test.local"  # seed_owner's
NEW_PASSWORD = "NewPassword456"
# Real plans with more than one branch have this; the test plan doesn't.
MULTI_BRANCH = [*conftest.ALL_FEATURES, "multi_branch"]


@pytest.fixture
def sent(monkeypatch):
    mail = []
    monkeypatch.setattr(platform_emails, "send_account_email", lambda **m: mail.append(m))
    return mail


def _sign_in(db, user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user
    conftest._active_schema["name"] = user.company.schema_name
    set_search_path(db, user.company.schema_name)


def _account(
    db,
    owner_role_id: int,
    *,
    email: str | None = EMAIL,
    username: str = "newowner",
    password: str = NEW_PASSWORD,
    verified: bool = True,
    features=MULTI_BRANCH,
    max_branches: int | None = None,
    name: str = "New Mill",
    sign_in: bool = True,
) -> SimpleNamespace:
    """A brand-new account: a company, its main branch, a plan and an owner."""
    plan = SubscriptionPlan(code=f"plan-{username}", name="Plan", features=list(features), max_branches=max_branches)
    company = Company(name=name)
    db.add_all([plan, company])
    db.flush()
    provision_tenant(company, db=db)
    branch = Branch(company_id=company.id, name="Main", is_main_branch=True)
    db.add(branch)
    db.flush()
    db.add(Subscription(company_id=company.id, plan_id=plan.id, status="active"))
    user = User(
        company_id=company.id,
        branch_id=branch.id,
        username=username,
        email=email,
        email_verified=verified,
        password_hash=hash_password(password),
        full_name="New Owner",
        role_id=owner_role_id,
        is_active=True,
    )
    db.add(user)
    db.flush()
    if sign_in:
        _sign_in(db, user)
    return SimpleNamespace(company=company, branch=branch, user=user, schema=company.schema_name)


def _close_old_account(db, old: User) -> None:
    """The old account lets go of its email, as a closed account does: an
    address belongs to one account at a time."""
    old.email = None
    db.flush()


def _names(db, schema: str) -> list[str]:
    db.expire_all()
    return list(db.execute(text(f'SELECT name FROM "{schema}".customers ORDER BY name')).scalars())


def _actions(db, schema: str) -> list[str]:
    return list(db.execute(text(f'SELECT action FROM "{schema}".activity_logs ORDER BY created_at, action')).scalars())


def _download(client, slug: str = "test-mill") -> bytes:
    res = client.get("/api/backup")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/octet-stream"
    assert re.search(rf'filename="{slug}-backup-\d{{4}}-\d{{2}}-\d{{2}}\.oraiza"', res.headers["content-disposition"])
    return res.content


def _post(client, route: str, data: bytes, **form):
    return client.post(
        f"/api/backup/{route}", files={"file": ("mill.oraiza", data, "application/octet-stream")}, data=form
    )


def _load(client, data: bytes, password: str = NEW_PASSWORD):
    return _post(client, "restore", data, current_password=password)


def _forged(email: str, company_id: uuid.UUID, *sections, made_by: uuid.UUID | None = None) -> bytes:
    """A file sealed with the real key, holding whatever a test likes: what a
    load would face if the key were ever stolen."""
    out = io.BytesIO()
    writer = data_backup._SealedWriter(out, email)
    records: list = [
        {
            "manifest": {
                "format": "oraiza-backup",
                "version": 1,
                "company_id": str(company_id),
                "company": "Old Mill",
                "created_at": "2026-10-20T08:00:00+00:00",
                "created_by": "oldowner",
                "made_by_id": str(made_by or uuid.uuid4()),
                "owner_email": email,
                "branches": [],
            }
        }
    ]
    rows = 0
    for table, columns, body in sections:
        records.append({"table": table, "columns": columns})
        records.extend(body)
        rows += len(body)
    records.append({"end": {"rows": rows}})
    for record in records:
        writer.write(json.dumps(record).encode() + b"\n")
    writer.close()
    return out.getvalue()


# ── the file ──────────────────────────────────────────────────────────────────


def test_the_owner_downloads_a_file_only_we_can_read(auth_client, seed_owner, db_session, sent):
    db_session.add(Customer(company_id=seed_owner.company_id, name="Bigas Trading"))
    db_session.add(
        Employee(company_id=seed_owner.company_id, first_name="Ana", last_name="Cruz", sss_no="34-1234567-8")
    )
    db_session.flush()

    data = _download(auth_client)
    assert data.startswith(data_backup.MAGIC)
    for plain in (b"Bigas Trading", b"34-1234567-8", b"Test Mill", b"customers", EMAIL.encode()):
        assert plain not in data

    assert _actions(db_session, seed_owner.company.schema_name) == ["data.backup"]
    assert [m["to"] for m in sent] == [EMAIL]
    assert "/retrieve-data" in sent[0]["text"]


def test_a_backup_needs_an_email_to_be_tied_to(auth_client, seed_owner, db_session, sent):
    seed_owner.email = None
    db_session.flush()
    res = auth_client.get("/api/backup")
    assert res.status_code == 400 and res.json()["code"] == "backup_no_email"


# ── loading it into a new account ─────────────────────────────────────────────


def test_a_new_account_gets_the_records_back(client, auth_client, seed_owner, db_session, sent):
    old = seed_owner.company
    staff = User(
        company_id=old.id,
        username="oldcashier",
        full_name="Old Cashier",
        email="cashier@test.local",
        password_hash=seed_owner.password_hash,
        role_id=seed_owner.role_id,
    )
    north = Branch(company_id=old.id, name="North Branch", address="Talavera")
    closed = Branch(company_id=old.id, name="Closed Branch", deleted_at=datetime(2026, 9, 1, tzinfo=timezone.utc))
    db_session.add_all([staff, north, closed])
    db_session.flush()
    db_session.add_all(
        [
            Customer(
                company_id=old.id,
                branch_id=seed_owner.branch_id,
                name="Main Customer",
                credit_limit=Decimal("15000.50"),
            ),
            Customer(company_id=old.id, branch_id=north.id, name="North Customer"),
            Employee(company_id=old.id, first_name="Ana", last_name="Owner", user_id=seed_owner.id, sss_no="34-1"),
            Employee(company_id=old.id, first_name="Ben", last_name="Cashier", user_id=staff.id),
        ]
    )
    db_session.flush()
    data = _download(auth_client)
    _close_old_account(db_session, seed_owner)

    new = _account(db_session, seed_owner.role_id)
    assert client.get("/api/backup/status").json() == {"empty": True, "email": EMAIL, "email_verified": True}
    checked = _post(client, "inspect", data)
    assert checked.status_code == 200, checked.text
    assert (checked.json()["company"], checked.json()["created_by"], checked.json()["branches"]) == (
        "Test Mill",
        "owner",
        2,
    )

    res = _load(client, data)
    assert res.status_code == 200, res.text

    s = new.schema
    assert _names(db_session, s) == ["Main Customer", "North Customer"]
    rows = db_session.execute(text(f'SELECT name, company_id, branch_id, credit_limit FROM "{s}".customers')).all()
    assert {r.company_id for r in rows} == {new.company.id}
    made = {
        r.name: r
        for r in db_session.execute(
            text("SELECT id, name, address, is_main_branch, deleted_at FROM public.branches WHERE company_id = :c"),
            {"c": new.company.id},
        )
    }
    assert set(made) == {"Main", "North Branch", "Closed Branch"}
    assert made["North Branch"].address == "Talavera" and not made["North Branch"].is_main_branch
    assert made["Closed Branch"].deleted_at is not None
    by_name = {r.name: r for r in rows}
    assert by_name["Main Customer"].branch_id == new.branch.id
    assert by_name["North Customer"].branch_id == made["North Branch"].id
    assert by_name["Main Customer"].credit_limit == Decimal("15000.50")
    # The old owner is the new owner; the old staff aren't this account's.
    people = dict(db_session.execute(text(f'SELECT last_name, user_id FROM "{s}".employees')).all())
    assert people == {"Owner": new.user.id, "Cashier": None}
    assert (
        db_session.execute(text(f"SELECT sss_no FROM \"{s}\".employees WHERE last_name = 'Owner'")).scalar() == "34-1"
    )
    assert db_session.execute(
        text("SELECT is_multi_branch FROM public.companies WHERE id = :c"), {"c": new.company.id}
    ).scalar()
    assert _actions(db_session, s) == ["data.restore"]
    assert "loaded" in sent[-1]["subject"].lower()

    # The old account is as it was.
    assert _names(db_session, old.schema_name) == ["Main Customer", "North Customer"]
    assert (
        db_session.execute(text("SELECT count(*) FROM public.branches WHERE company_id = :c"), {"c": old.id}).scalar()
        == 3
    )
    assert client.get("/api/backup/status").json()["empty"] is False


def test_stacked_pallets_come_back_stacked(client, auth_client, seed_owner, db_session, sent):
    layout = WarehouseLayout(branch_id=seed_owner.branch_id, company_id=seed_owner.company_id, name="Bodega")
    db_session.add(layout)
    db_session.flush()
    # The upper pallet sorts first, so it is loaded before the one it sits on.
    bottom = uuid.UUID("ffffffff-0000-4000-8000-000000000000")
    top = uuid.UUID("00000000-0000-4000-8000-000000000000")
    common = dict(company_id=seed_owner.company_id, layout_id=layout.id, x_m=1, y_m=1, sack_count=20, weight_kg=1000)
    db_session.add(Pallet(id=bottom, pallet_code="P-1", **common))
    db_session.flush()
    db_session.add(Pallet(id=top, pallet_code="P-2", stack_parent_id=bottom, z_layer=1, **common))
    db_session.flush()
    data = _download(auth_client)
    _close_old_account(db_session, seed_owner)

    new = _account(db_session, seed_owner.role_id)
    assert _load(client, data).status_code == 200
    db_session.expire_all()
    s = new.schema
    assert (
        db_session.execute(text(f'SELECT stack_parent_id FROM "{s}".pallets WHERE id = :id'), {"id": top}).scalar()
        == bottom
    )
    assert db_session.execute(text(f'SELECT branch_id FROM "{s}".warehouse_layouts')).scalar() == new.branch.id


def test_status_counts_only_the_accounts_own_records(client, seed_owner, db_session):
    new = _account(db_session, seed_owner.role_id, email="fresh@test.local")
    assert client.get("/api/backup/status").json()["empty"] is True
    # The shared catalog every account starts with, and the app's own
    # bookkeeping, don't count.
    db_session.add(AutomationState(company_id=new.company.id, recipe="low_stock", key="x"))
    db_session.flush()
    assert client.get("/api/backup/status").json()["empty"] is True
    db_session.add(Customer(company_id=new.company.id, name="First"))
    db_session.flush()
    assert client.get("/api/backup/status").json()["empty"] is False


def test_only_an_empty_account_takes_a_backup(client, auth_client, seed_owner, db_session, sent):
    data = _download(auth_client)
    _close_old_account(db_session, seed_owner)
    new = _account(db_session, seed_owner.role_id)
    db_session.add(Customer(company_id=new.company.id, name="Already Here"))
    db_session.flush()

    for route in ("inspect", "restore"):
        res = _post(client, route, data, current_password=NEW_PASSWORD)
        assert res.status_code == 400 and res.json()["code"] == "backup_not_empty", res.text
    assert _names(db_session, new.schema) == ["Already Here"]


def test_another_email_cannot_open_it(client, auth_client, seed_owner, db_session, sent):
    db_session.add(Customer(company_id=seed_owner.company_id, name="Old Customer"))
    db_session.flush()
    data = _download(auth_client)
    new = _account(db_session, seed_owner.role_id, email="stranger@test.local", username="stranger")

    for route in ("inspect", "restore"):
        res = _post(client, route, data, current_password=NEW_PASSWORD)
        assert res.status_code == 400 and res.json()["code"] == "backup_not_yours", res.text
    assert _names(db_session, new.schema) == []


def test_an_unconfirmed_email_cannot_load_it(client, auth_client, seed_owner, db_session, sent):
    data = _download(auth_client)
    _close_old_account(db_session, seed_owner)
    _account(db_session, seed_owner.role_id, verified=False)
    res = _post(client, "inspect", data)
    assert res.status_code == 400 and res.json()["code"] == "backup_email_unverified"


def test_the_old_username_is_refused(auth_client, seed_owner, db_session, sent):
    """Loading it back into the account it came from, emptied: same username."""
    db_session.add(Customer(company_id=seed_owner.company_id, name="Old Customer"))
    db_session.flush()
    data = _download(auth_client)
    db_session.execute(text("DELETE FROM customers"))
    seed_owner.email_verified = True
    db_session.flush()

    res = _load(auth_client, data, password="Password123")
    assert res.status_code == 400 and res.json()["code"] == "backup_same_login", res.text
    assert "new username" in res.json()["detail"]
    assert _names(db_session, seed_owner.company.schema_name) == []


def test_the_old_password_is_refused(client, auth_client, seed_owner, db_session, sent):
    data = _download(auth_client)
    _close_old_account(db_session, seed_owner)
    new = _account(db_session, seed_owner.role_id, password="Password123")  # seed_owner's own

    assert _post(client, "inspect", data).status_code == 200  # the file itself is fine
    res = _load(client, data, password="Password123")
    assert res.status_code == 400 and res.json()["code"] == "backup_same_login", res.text
    assert "new password" in res.json()["detail"]
    assert data_backup.is_empty(db_session, new.company)


@pytest.mark.parametrize(
    ("features", "max_branches", "message"),
    [
        (conftest.ALL_FEATURES, None, "allows 1 branch, and this backup has 3"),
        (MULTI_BRANCH, 2, "allows 2 branches, and this backup has 3"),
    ],
)
def test_more_branches_than_the_plan_allows_asks_for_an_upgrade(
    client, auth_client, seed_owner, db_session, sent, features, max_branches, message
):
    db_session.add_all([Branch(company_id=seed_owner.company_id, name=f"Branch {i}") for i in (2, 3)])
    db_session.flush()
    data = _download(auth_client)
    _close_old_account(db_session, seed_owner)
    new = _account(db_session, seed_owner.role_id, features=features, max_branches=max_branches)

    for route in ("inspect", "restore"):
        res = _post(client, route, data, current_password=NEW_PASSWORD)
        assert res.status_code == 400 and res.json()["code"] == "backup_branch_limit", res.text
        assert message in res.json()["detail"] and "Upgrade" in res.json()["detail"]
    count = "SELECT count(*) FROM public.branches WHERE company_id = :c"
    assert db_session.execute(text(count), {"c": new.company.id}).scalar() == 1


def test_a_plan_with_room_takes_every_branch(client, auth_client, seed_owner, db_session, sent):
    db_session.add_all([Branch(company_id=seed_owner.company_id, name=f"Branch {i}") for i in (2, 3)])
    db_session.flush()
    data = _download(auth_client)
    _close_old_account(db_session, seed_owner)
    new = _account(db_session, seed_owner.role_id, max_branches=3)
    assert _load(client, data).status_code == 200
    count = "SELECT count(*) FROM public.branches WHERE company_id = :c"
    assert db_session.execute(text(count), {"c": new.company.id}).scalar() == 3


def test_a_changed_file_is_refused_and_nothing_changes(client, auth_client, seed_owner, db_session, sent):
    db_session.add(Customer(company_id=seed_owner.company_id, name="Old Customer"))
    db_session.flush()
    changed = bytearray(_download(auth_client))
    changed[len(changed) // 2] ^= 0x01
    _close_old_account(db_session, seed_owner)
    new = _account(db_session, seed_owner.role_id)

    for route in ("inspect", "restore"):
        res = _post(client, route, bytes(changed), current_password=NEW_PASSWORD)
        assert res.status_code == 400 and res.json()["code"] == "backup_not_yours", res.text
    assert data_backup.is_empty(db_session, new.company)
    assert _actions(db_session, new.schema) == []


def test_a_file_that_isnt_a_backup_is_refused(client, seed_owner, db_session, sent):
    _account(db_session, seed_owner.role_id, email="new@test.local", username="new")
    res = _load(client, b"PK\x03\x04 a spreadsheet export")
    assert res.status_code == 400 and res.json()["code"] == "backup_not_a_backup"


def test_a_load_never_touches_another_account(client, auth_client, seed_owner, db_session, sent):
    db_session.add(Customer(company_id=seed_owner.company_id, name="Old Customer"))
    db_session.flush()
    data = _download(auth_client)
    _close_old_account(db_session, seed_owner)
    other = _account(db_session, seed_owner.role_id, email="other@test.local", username="other", name="Other Mill")
    db_session.add(Customer(company_id=other.company.id, name="Other Customer"))
    db_session.flush()
    users_before = db_session.execute(
        text("SELECT id, username, email, company_id FROM public.users ORDER BY id")
    ).all()

    new = _account(db_session, seed_owner.role_id)
    assert _load(client, data).status_code == 200
    assert _names(db_session, new.schema) == ["Old Customer"]
    assert _names(db_session, other.schema) == ["Other Customer"]
    assert _names(db_session, seed_owner.company.schema_name) == ["Old Customer"]
    users_after = db_session.execute(text("SELECT id, username, email, company_id FROM public.users ORDER BY id")).all()
    # Only the new account's own owner was added, and nobody else changed.
    assert set(users_after) == set(users_before) | {(new.user.id, new.user.username, new.user.email, new.company.id)}


def test_a_forged_file_cannot_write_outside_the_account(client, seed_owner, db_session, sent):
    """Even sealed with our key: shared tables are never written, the old mill's
    id becomes the new one's, and another account's branch is dropped."""
    other = _account(db_session, seed_owner.role_id, email="other@test.local", username="other", name="Other Mill")
    new = _account(db_session, seed_owner.role_id, email="new@test.local", username="new")
    old_mill = uuid.uuid4()
    forged = _forged(
        "new@test.local",
        old_mill,
        ("users", ["id", "username", "company_id"], [[str(other.user.id), "hijacked", str(old_mill)]]),
        ("companies", ["id", "name"], [[str(other.company.id), "Renamed"]]),
        ("public.users", ["id", "username"], [[str(other.user.id), "hijacked"]]),
        (
            "activity_logs",
            ["id", "company_id", "action", "entity_type"],
            [[str(uuid.uuid4()), str(old_mill), "x", "y"]],
        ),
        (
            "customers",
            ["id", "company_id", "branch_id", "name"],
            [[str(uuid.uuid4()), str(old_mill), str(other.branch.id), "Forged"]],
        ),
    )
    res = _load(client, forged)
    assert res.status_code == 200, res.text

    s = new.schema
    assert _names(db_session, s) == ["Forged"]
    assert db_session.execute(text(f'SELECT company_id, branch_id FROM "{s}".customers')).one() == (
        new.company.id,
        None,
    )
    who = db_session.execute(text("SELECT username FROM public.users WHERE id = :id"), {"id": other.user.id}).scalar()
    assert who == "other"
    named = db_session.execute(
        text("SELECT name FROM public.companies WHERE id = :id"), {"id": other.company.id}
    ).scalar()
    assert named == "Other Mill"
    assert _actions(db_session, s) == ["data.restore"]
    assert _names(db_session, other.schema) == []


def test_a_forged_row_for_another_account_is_refused(client, seed_owner, db_session, sent):
    other = _account(db_session, seed_owner.role_id, email="other@test.local", username="other", name="Other Mill")
    new = _account(db_session, seed_owner.role_id, email="new@test.local", username="new")
    forged = _forged(
        "new@test.local",
        uuid.uuid4(),
        ("customers", ["id", "company_id", "name"], [[str(uuid.uuid4()), str(other.company.id), "Theirs"]]),
    )
    res = _load(client, forged)
    assert res.status_code == 400 and res.json()["code"] == "backup_not_yours"
    assert _names(db_session, new.schema) == [] and _names(db_session, other.schema) == []


def test_names_in_the_file_never_reach_sql(client, seed_owner, db_session, sent):
    new = _account(db_session, seed_owner.role_id, email="new@test.local", username="new")
    old_mill = uuid.uuid4()
    injected = 'name" text); DROP TABLE customers; --'
    forged = _forged(
        "new@test.local",
        old_mill,
        ("customers", ["id", "company_id", injected], [[str(uuid.uuid4()), str(old_mill), "x"]]),
    )
    # The odd column is no column of ours, so "name" is missing: refused whole.
    res = _load(client, forged)
    assert res.status_code == 400 and res.json()["code"] == "backup_too_old"

    forged = _forged(
        "new@test.local", old_mill, ('customers"; DROP TABLE customers; --', ["id"], [[str(uuid.uuid4())]])
    )
    assert _load(client, forged).status_code == 200
    # An unknown table is skipped, and the real one is still there.
    assert _names(db_session, new.schema) == []


# ── who may ───────────────────────────────────────────────────────────────────


def test_a_wrong_password_changes_nothing(client, auth_client, seed_owner, db_session, sent):
    data = _download(auth_client)
    _close_old_account(db_session, seed_owner)
    new = _account(db_session, seed_owner.role_id)
    for password in ("wrong-password", ""):
        res = _load(client, data, password=password)
        assert res.status_code == 400 and res.json()["code"] == "confirm_failed", res.text
    assert data_backup.is_empty(db_session, new.company)


@pytest.mark.parametrize("role_name", ["admin", "cashier", "accountant"])
def test_only_the_owner_may(make_auth_client, role_name, sent):
    c = make_auth_client(["sales"], username=role_name, role_name=role_name)
    assert c.get("/api/backup").status_code == 403
    assert c.get("/api/backup/status").status_code == 403
    assert _post(c, "inspect", b"x").status_code == 403
    assert _load(c, b"x").status_code == 403
    assert sent == []


def test_a_platform_admin_may_not(admin_client, sent):
    assert admin_client.get("/api/backup").status_code == 403
    assert _post(admin_client, "inspect", b"x").status_code == 403
    assert _load(admin_client, b"x").status_code == 403


def test_a_file_too_big_is_refused(auth_client, monkeypatch, sent):
    monkeypatch.setattr(settings, "DATA_BACKUP_MAX_MB", 0)
    assert _post(auth_client, "inspect", b"x").status_code == 413
    assert _load(auth_client, b"x").status_code == 413


def test_a_session_on_the_wrong_schema_is_refused(seed_owner, db_session):
    db_session.execute(text("SET LOCAL search_path TO public"))
    now = datetime.now(timezone.utc)
    with pytest.raises(RuntimeError, match="isn't scoped"):
        data_backup.build(db_session, seed_owner.company, made_by=seed_owner, now=now)
    seed_owner.email_verified = True
    with pytest.raises(RuntimeError, match="isn't scoped"):
        data_backup.restore(db_session, seed_owner.company, seed_owner, io.BytesIO(b""), password="x")


def test_changing_an_email_on_the_users_page_needs_confirming_again(auth_client, seed_owner, db_session):
    """Otherwise a fresh account could take over someone else's address, and
    with it their backups."""
    seed_owner.email_verified = True
    db_session.flush()
    res = auth_client.put(f"/api/users/{seed_owner.id}", json={"email": "someone.else@test.local"})
    assert res.status_code == 200, res.text
    db_session.expire_all()
    assert db_session.get(User, seed_owner.id).email_verified is False


def test_the_routes_are_rate_limited():
    from app.core.ratelimit import limiter

    def limits(name: str) -> list[str]:
        return [str(lim.limit) for lim in limiter._route_limits.get(f"app.api.data_backup.{name}", [])]

    assert limits("download_backup") == ["3 per 1 hour"]
    assert limits("inspect_backup") == ["5 per 1 hour"]
    assert limits("restore_backup") == ["5 per 1 hour"]
    for name in ("inspect_tenant_backup", "restore_tenant_backup"):
        assert [str(lim.limit) for lim in limiter._route_limits.get(f"app.api.admin.{name}", [])] == ["5 per 1 hour"]


# ── BossAdmin loading a backup into an empty tenant ───────────────────────────


def _as_platform_admin(db, role_id: int) -> User:
    admin = User(
        username="bossadmin",
        full_name="Platform Admin",
        email="admin@test.local",
        password_hash=hash_password("AdminPassword1"),
        role_id=role_id,
        is_active=True,
        is_platform_admin=True,
    )
    db.add(admin)
    db.flush()
    app.dependency_overrides[get_current_user] = lambda: admin
    return admin


def _admin_post(client, tenant_id: uuid.UUID, route: str, data: bytes, **form):
    return client.post(
        f"/api/admin/tenants/{tenant_id}/backup/{route}",
        files={"file": ("mill.oraiza", data, "application/octet-stream")},
        data=form,
    )


def test_the_platform_admin_loads_a_backup_without_the_owners_checks(client, auth_client, seed_owner, db_session, sent):
    db_session.add(Customer(company_id=seed_owner.company_id, name="Old Customer"))
    db_session.add_all([Branch(company_id=seed_owner.company_id, name=f"Branch {i}") for i in (2, 3)])
    db_session.flush()
    data = _download(auth_client)
    # The tenant's Boss has no email, let alone a confirmed one, and a plan with
    # one branch: an owner couldn't load this file here.
    new = _account(db_session, seed_owner.role_id, email=None, verified=False, max_branches=1, sign_in=False)
    route = f"/api/admin/tenants/{new.company.id}/backup/status"
    assert client.get(route).status_code == 403  # an owner can't use the admin's way in
    _as_platform_admin(db_session, seed_owner.role_id)

    assert client.get(route).json() == {"empty": True, "has_boss": True, "owner_email": None}
    res = _admin_post(client, new.company.id, "inspect", data)
    assert res.status_code == 400 and res.json()["code"] == "backup_no_email", res.text
    res = _admin_post(client, new.company.id, "inspect", data, email="stranger@test.local")
    assert res.status_code == 400 and res.json()["code"] == "backup_not_yours", res.text
    assert "email of the owner" in res.json()["detail"]

    checked = _admin_post(client, new.company.id, "inspect", data, email=EMAIL)
    assert checked.status_code == 200, checked.text
    assert (checked.json()["company"], checked.json()["branches"]) == ("Test Mill", 3)

    res = _admin_post(client, new.company.id, "restore", data, email=f" {EMAIL.upper()} ")
    assert res.status_code == 200, res.text
    assert _names(db_session, new.schema) == ["Old Customer"]
    live = "SELECT count(*) FROM public.branches WHERE company_id = :c AND deleted_at IS NULL"
    assert db_session.execute(text(live), {"c": new.company.id}).scalar() == 3
    assert _actions(db_session, new.schema) == ["data.restore"]
    assert client.get(route).json()["empty"] is False


def test_the_platform_admin_loads_only_into_an_empty_tenant(client, auth_client, seed_owner, db_session, sent):
    data = _download(auth_client)
    _close_old_account(db_session, seed_owner)
    new = _account(db_session, seed_owner.role_id, sign_in=False)  # its Boss has the backup's email
    db_session.add(Customer(company_id=new.company.id, name="Already Here"))
    db_session.flush()
    _as_platform_admin(db_session, seed_owner.role_id)

    for route in ("inspect", "restore"):
        res = _admin_post(client, new.company.id, route, data)
        assert res.status_code == 400 and res.json()["code"] == "backup_not_empty", res.text
        assert "empty tenant" in res.json()["detail"]
    assert _names(db_session, new.schema) == ["Already Here"]

    # Emptied, it opens with the Boss's own email when none is given.
    db_session.execute(text(f'DELETE FROM "{new.schema}".customers'))
    db_session.flush()
    checked = _admin_post(client, new.company.id, "inspect", data)
    assert checked.status_code == 200, checked.text
