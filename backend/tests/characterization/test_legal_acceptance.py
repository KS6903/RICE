"""Characterization: publishing the agreements and recording who accepted them.

The point of these tests is evidentiary. If consent can be skipped, or if an
acceptance row does not pin down the exact text that was on screen, the Terms
are much harder to rely on in a dispute.
"""
from app.core import legal
from app.models.legal import LegalAcceptance
from app.models.subscription import SubscriptionPlan
from app.models.user import Role

NATIVE_HEADERS = {"X-Client-Type": "bearer", "User-Agent": "Electron/Test"}


def _prereqs(db):
    db.add(Role(id=1, name="owner"))
    db.add(SubscriptionPlan(code="free", name="Free", features=[]))
    db.flush()


def _signup_body(**overrides):
    body = {
        "company_name": "NewCo",
        "full_name": "New Owner",
        "username": "newowner",
        "email": "newowner@gmail.com",
        "password": "password123",
        "accepted_terms": True,
    }
    body.update(overrides)
    return body


# ── Publishing ────────────────────────────────────────────────────────────


def test_documents_are_readable_without_a_session(client):
    """Terms nobody could read before agreeing are weak terms."""
    res = client.get("/api/legal/documents")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["agreement_version"] == legal.AGREEMENT_VERSION
    assert {d["key"] for d in body["documents"]} >= {"terms", "privacy", "dpa", "aup"}


def test_document_body_is_served_with_its_hash(client):
    res = client.get("/api/legal/documents/terms")
    assert res.status_code == 200
    body = res.json()
    assert body["markdown"].lstrip().startswith("#")
    assert body["sha256"] == legal.content_hash("terms")


def test_unknown_document_404s(client):
    assert client.get("/api/legal/documents/not-a-document").status_code == 404


# ── Acceptance at signup ──────────────────────────────────────────────────


def test_signup_without_consent_is_refused(client, db_session):
    _prereqs(db_session)
    res = client.post(
        "/api/auth/signup", headers=NATIVE_HEADERS, json=_signup_body(accepted_terms=False)
    )
    assert res.status_code == 400, res.text
    assert "accept" in res.json()["detail"].lower()


def test_signup_with_a_stale_agreement_version_is_refused(client, db_session):
    """A tab open since before a terms change must not bind the user."""
    _prereqs(db_session)
    res = client.post(
        "/api/auth/signup",
        headers=NATIVE_HEADERS,
        json=_signup_body(agreement_version="1999.01.1"),
    )
    assert res.status_code == 409, res.text


def test_signup_records_what_was_accepted(client, db_session):
    _prereqs(db_session)
    res = client.post(
        "/api/auth/signup",
        headers=NATIVE_HEADERS,
        json=_signup_body(agreement_version=legal.AGREEMENT_VERSION),
    )
    assert res.status_code == 201, res.text

    row = db_session.query(LegalAcceptance).one()
    assert row.agreement_version == legal.AGREEMENT_VERSION
    assert row.content_hash == legal.bundle_hash()
    assert row.method == "signup"
    assert row.company_id is not None
    # The per-document manifest is what makes the row usable as evidence: it
    # pins each document's version and the hash of the exact rendered text.
    assert [d["key"] for d in row.documents] == list(legal.BUNDLE_KEYS)
    assert all(len(d["sha256"]) == 64 for d in row.documents)


def test_me_reports_no_outstanding_acceptance_after_signup(client, db_session):
    _prereqs(db_session)
    tokens = client.post(
        "/api/auth/signup", headers=NATIVE_HEADERS, json=_signup_body()
    ).json()
    res = client.get(
        "/api/auth/me", headers={**NATIVE_HEADERS, "Authorization": f"Bearer {tokens['access_token']}"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["legal_acceptance_required"] is False


# ── Re-acceptance ─────────────────────────────────────────────────────────


def test_existing_account_without_an_acceptance_is_gated(auth_client, seed_owner):
    """Accounts that predate the ledger have to accept before continuing."""
    res = auth_client.get("/api/auth/me")
    assert res.status_code == 200
    assert res.json()["legal_acceptance_required"] is True

    status = auth_client.get("/api/legal/acceptance")
    assert status.status_code == 200
    assert status.json()["acceptance_required"] is True
    assert status.json()["accepted_version"] is None


def test_accepting_clears_the_gate_and_is_idempotent(auth_client, seed_owner, db_session):
    assert auth_client.post("/api/legal/acceptance").status_code == 201
    assert auth_client.get("/api/auth/me").json()["legal_acceptance_required"] is False

    # A second click must not stack duplicate rows for one act of consent.
    auth_client.post("/api/legal/acceptance")
    assert db_session.query(LegalAcceptance).count() == 1


def test_a_new_agreement_version_reopens_the_gate(auth_client, seed_owner, monkeypatch):
    auth_client.post("/api/legal/acceptance")
    assert auth_client.get("/api/auth/me").json()["legal_acceptance_required"] is False

    monkeypatch.setattr(legal, "AGREEMENT_VERSION", "2099.12.1")
    assert auth_client.get("/api/auth/me").json()["legal_acceptance_required"] is True


def test_republished_text_at_the_same_version_reopens_the_gate(
    auth_client, seed_owner, monkeypatch
):
    """Nobody should be treated as bound by text they were never shown.

    Even without a version bump, a changed document changes the bundle hash,
    and the stored hash no longer matches.
    """
    auth_client.post("/api/legal/acceptance")
    assert auth_client.get("/api/auth/me").json()["legal_acceptance_required"] is False

    monkeypatch.setattr(legal, "bundle_hash", lambda: "0" * 64)
    assert auth_client.get("/api/auth/me").json()["legal_acceptance_required"] is True


def test_acceptance_history_is_visible_to_the_user(auth_client, seed_owner):
    auth_client.post("/api/legal/acceptance")
    res = auth_client.get("/api/legal/acceptance/history")
    assert res.status_code == 200
    history = res.json()
    assert len(history) == 1
    assert history[0]["agreement_version"] == legal.AGREEMENT_VERSION
    assert history[0]["method"] == "gate"


def test_acceptance_requires_a_session(client):
    assert client.get("/api/legal/acceptance").status_code in (401, 403)
    assert client.post("/api/legal/acceptance").status_code in (401, 403)


def test_platform_admin_is_not_gated(admin_client):
    """The platform owner is the other party to these agreements, not a
    customer bound by them, so the admin console is never blocked by consent."""
    res = admin_client.get("/api/auth/me")
    assert res.status_code == 200, res.text
    assert res.json()["is_platform_admin"] is True
    assert res.json()["legal_acceptance_required"] is False
