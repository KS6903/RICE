"""The owner's data export: everything the mill keeps, nothing that signs in,
nobody else's rows, and only the owner may take it."""

from __future__ import annotations

import csv
import io
import json
import zipfile
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from app.models.employee import Employee
from app.models.supplier_customer import Customer
from app.services import data_export, platform_emails
from tests import conftest

NOW = datetime(2026, 10, 3, tzinfo=timezone.utc)


def _unzip(res) -> zipfile.ZipFile:
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/zip"
    return zipfile.ZipFile(io.BytesIO(res.content))


def _csv(zf: zipfile.ZipFile, name: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(zf.read(name).decode("utf-8-sig"))))


@pytest.fixture
def sent(monkeypatch):
    mail = []
    monkeypatch.setattr(platform_emails, "send_account_email", lambda **m: mail.append(m))
    return mail


def test_the_owner_gets_every_table_and_a_receipt(auth_client, seed_owner, db_session, sent):
    db_session.add(
        Employee(
            company_id=seed_owner.company_id,
            first_name="Ana",
            last_name="Cruz",
            sss_no="34-1234567-8",
        )
    )
    db_session.add(Customer(company_id=seed_owner.company_id, name='=HYPERLINK("http://x")'))
    db_session.flush()

    zf = _unzip(auth_client.get("/api/export"))
    names = set(zf.namelist())
    assert {"README.txt", "manifest.json", "company.csv", "users.csv", "branches.csv"} <= names
    assert {f"data/{t.name}.csv" for t in data_export.exported_tables()} <= names

    [employee] = _csv(zf, "data/employees.csv")
    assert (employee["first_name"], employee["sss_no"]) == ("Ana", "34-1234567-8")
    [customer] = _csv(zf, "data/customers.csv")
    assert customer["name"] == '\'=HYPERLINK("http://x")'  # opens as text, not a live formula

    manifest = json.loads(zf.read("manifest.json"))
    assert manifest["files"]["data/employees.csv"] == 1
    assert manifest["files"]["users.csv"] == 1

    assert [m["to"] for m in sent] == ["owner@test.local"]
    logged = db_session.execute(text("SELECT action, detail FROM activity_logs")).all()
    assert [a for a, _ in logged] == ["data.export"]


def test_sign_in_secrets_never_leave(auth_client, seed_owner, db_session, sent):
    seed_owner.mfa_secret = "MFA-SEED-VALUE"
    seed_owner.mfa_backup_codes = ["backup-code-hash"]
    db_session.flush()
    zf = _unzip(auth_client.get("/api/export"))

    [user] = _csv(zf, "users.csv")
    assert user["username"] == "owner" and user["role"] == "owner"
    assert not {"password_hash", "mfa_secret", "mfa_backup_codes", "email_verification_hash"} & set(user)
    everything = b"".join(zf.read(n) for n in zf.namelist())
    for secret in (seed_owner.password_hash, "MFA-SEED-VALUE", "backup-code-hash"):
        assert secret.encode() not in everything


def test_no_column_in_the_mills_tables_looks_like_a_credential():
    """A new secret-like column must be decided on, not exported by default."""
    named = {
        f"{t.name}.{c.name}"
        for t in data_export.exported_tables()
        for c in data_export.exported_columns(t)
        if data_export.SECRET_COLUMN.search(c.name)
    }
    assert named == set()


def test_another_mills_rows_stay_out(make_auth_client, db_session, sent):
    theirs = make_auth_client(["sales"], username="theirs")
    assert theirs.post("/api/sales/customers", json={"name": "Their Customer"}).status_code in (200, 201)
    their_schema = conftest._active_schema["name"]

    make_auth_client([], username="mine")  # an owner on a plan with nothing in it
    assert conftest._active_schema["name"] != their_schema
    zf = _unzip(theirs.get("/api/export"))  # same client, now signed in as "mine"
    everything = b"".join(zf.read(n) for n in zf.namelist())
    assert b"Their Customer" not in everything
    assert b"theirs" not in everything
    [company] = _csv(zf, "company.csv")
    assert company["name"].startswith("Co mine")


@pytest.mark.parametrize("role_name", ["admin", "cashier", "accountant"])
def test_only_the_owner_may_export(make_auth_client, role_name, sent):
    c = make_auth_client(["sales"], username=role_name, role_name=role_name)
    assert c.get("/api/export").status_code == 403
    assert sent == []


def test_a_platform_admin_may_not(admin_client, sent):
    assert admin_client.get("/api/export").status_code == 403


def test_a_session_on_the_wrong_schema_is_refused(seed_owner, db_session):
    db_session.execute(text("SET LOCAL search_path TO public"))
    with pytest.raises(RuntimeError, match="isn't scoped"):
        data_export.build(db_session, seed_owner.company, exported_by=seed_owner, now=NOW)


def test_the_route_is_rate_limited():
    from app.core.ratelimit import limiter

    limits = limiter._route_limits.get("app.api.data_export.export_everything", [])
    assert [str(lim.limit) for lim in limits] == ["3 per 1 hour"]
