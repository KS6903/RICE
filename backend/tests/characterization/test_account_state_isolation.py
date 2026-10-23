"""/auth/me loads an account in two queries: the token check (user, company,
role and a live sign-in, together), then the account state (subscription,
plan, terms and unread count, together). Folding them into single queries
must never let one account see another's: these pin that down with two mills,
each with its own plan, terms, notices and sign-ins.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.core.security import authenticate_access_token, create_access_token
from app.core.tenancy import provision_tenant, set_search_path
from app.models.auth_session import AuthSession
from app.models.company import Branch, Company
from app.models.notification import Notification
from app.models.subscription import Subscription, SubscriptionPlan
from app.models.user import User
from app.services import auth_service
from app.services.auth_service import AuthService
from app.services.legal_service import LegalService


def _other_mill(db_session, owner: User) -> User:
    """A second mill: its own plan, schema, branch and owner."""
    plan = SubscriptionPlan(code="other-plan", name="Other Plan", features=["dashboard"])
    company = Company(name="Other Mill")
    db_session.add_all([plan, company])
    db_session.flush()
    provision_tenant(company, db=db_session)
    branch = Branch(company_id=company.id, name="Main", is_main_branch=True)
    db_session.add(branch)
    db_session.flush()
    db_session.add(Subscription(company_id=company.id, plan_id=plan.id, status="active"))
    other = User(
        company_id=company.id,
        branch_id=branch.id,
        username="other-owner",
        email="other-owner@test.local",
        password_hash=owner.password_hash,
        full_name="Other Owner",
        role_id=owner.role_id,
        is_active=True,
    )
    db_session.add(other)
    db_session.flush()
    return other


def _notices(db_session, user: User, count: int) -> None:
    set_search_path(db_session, user.company.schema_name)
    for i in range(count):
        db_session.add(
            Notification(
                company_id=user.company_id,
                user_id=user.id,
                kind="test",
                title=f"Notice {i}",
                dedupe_key=f"test-{user.id}-{i}",
            )
        )
    db_session.flush()


def _signed_in(db_session, user: User) -> AuthSession:
    session = AuthSession(
        family_id=uuid.uuid4(),
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db_session.add(session)
    db_session.flush()
    return session


def _token(user: User, session: AuthSession, **override) -> str:
    claims = {**AuthService._full_payload(user), "sid": str(session.family_id), **override}
    return create_access_token(claims)


def _me(db_session, user: User) -> dict:
    # A request runs scoped to the caller's own schema.
    set_search_path(db_session, user.company.schema_name)
    return AuthService(db_session, user).me()


@pytest.fixture
def two_mills(db_session, seed_owner, monkeypatch):
    # Start from a process that has seen no schema yet, so the first /me of each
    # mill takes the savepoint path and the second the single query.
    monkeypatch.setattr(auth_service, "_SCHEMAS_WITH_NOTIFICATIONS", set())
    other = _other_mill(db_session, seed_owner)
    _notices(db_session, seed_owner, 2)
    _notices(db_session, other, 3)
    LegalService(db_session).record_acceptance(user_id=seed_owner.id, company_id=seed_owner.company_id, request=None)
    db_session.flush()
    return seed_owner, other


def test_each_mill_sees_only_its_own_plan_terms_and_notices(db_session, two_mills):
    mine, theirs = two_mills
    # Twice each, alternating: the savepoint path, then the single query.
    for _ in range(2):
        a = _me(db_session, mine)
        b = _me(db_session, theirs)
        assert (a["subscription"]["name"], b["subscription"]["name"]) == ("Test Plan", "Other Plan")
        assert (a["notifications_unread"], b["notifications_unread"]) == (2, 3)
        assert (a["legal_acceptance_required"], b["legal_acceptance_required"]) == (False, True)
    assert {mine.company.schema_name, theirs.company.schema_name} <= auth_service._SCHEMAS_WITH_NOTIFICATIONS


def test_a_sign_in_is_accepted_for_its_own_user(db_session, two_mills):
    mine, _ = two_mills
    user, _payload = authenticate_access_token(_token(mine, _signed_in(db_session, mine)), db_session)
    assert user.id == mine.id


def test_another_users_sign_in_is_refused(db_session, two_mills):
    mine, theirs = two_mills
    # A token for one user carrying another user's live sign-in.
    with pytest.raises(HTTPException) as refused:
        authenticate_access_token(_token(mine, _signed_in(db_session, theirs)), db_session)
    assert refused.value.status_code == 401


def test_a_signed_out_sign_in_is_refused(db_session, two_mills):
    mine, _ = two_mills
    session = _signed_in(db_session, mine)
    session.revoked_at = datetime.now(timezone.utc)
    db_session.flush()
    with pytest.raises(HTTPException) as refused:
        authenticate_access_token(_token(mine, session), db_session)
    assert refused.value.detail == "Session has been revoked"


def test_a_token_pointing_at_another_mill_is_refused(db_session, two_mills):
    mine, theirs = two_mills
    session = _signed_in(db_session, mine)
    for forged in (
        {"schema": theirs.company.schema_name},
        {"company_id": str(theirs.company_id)},
    ):
        with pytest.raises(HTTPException) as refused:
            authenticate_access_token(_token(mine, session, **forged), db_session)
        assert refused.value.detail == "Invalid token"


@pytest.mark.parametrize("override", [{"sub": "not-a-user-id"}, {"sid": "not-a-sign-in"}])
def test_malformed_ids_are_refused(db_session, two_mills, override):
    mine, _ = two_mills
    with pytest.raises(HTTPException) as refused:
        authenticate_access_token(_token(mine, _signed_in(db_session, mine), **override), db_session)
    assert refused.value.status_code == 401
