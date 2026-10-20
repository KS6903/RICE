"""Open sign-up behind Cloudflare Turnstile.

With SIGNUP_OPEN anyone may create a mill without the invite code. Every
sign-up then provisions a schema, so a bot must not be able to make them: the
form carries a Turnstile token and the API checks it with Cloudflare first,
refusing on any doubt (no token, a failed or unreachable check, another
action, another hostname).
"""

from __future__ import annotations

import httpx
import pytest
from pydantic import SecretStr

from app.core import turnstile
from app.core.config import settings
from app.models.subscription import SubscriptionPlan
from app.models.user import Role, User

NATIVE_HEADERS = {"X-Client-Type": "bearer", "User-Agent": "Electron/Test"}
HOST = "app.oraiza.workers.dev"


def _prereqs(db):
    db.add(Role(id=1, name="owner"))
    db.add(SubscriptionPlan(code="free", name="Free", features=[]))
    db.flush()


def _body(**overrides):
    body = {
        "company_name": "Open Mill",
        "full_name": "Open Owner",
        "username": "openowner",
        "email": "openowner@gmail.com",
        "password": "password123",
        "accepted_terms": True,
    }
    body.update(overrides)
    return body


def _sign_up(client, **overrides):
    return client.post("/api/auth/signup", headers=NATIVE_HEADERS, json=_body(**overrides))


@pytest.fixture
def invite_only(monkeypatch):
    monkeypatch.setattr(settings, "SIGNUP_INVITE_CODE", SecretStr("invite-0123456789abcdef"))
    monkeypatch.setattr(settings, "SIGNUP_OPEN", False)


@pytest.fixture
def siteverify(monkeypatch):
    """Open sign-up with Turnstile on; returns a dict to set Cloudflare's answer.
    Each request to siteverify is recorded in answer["calls"]."""
    monkeypatch.setattr(settings, "SIGNUP_OPEN", True)
    monkeypatch.setattr(settings, "TURNSTILE_SECRET", SecretStr("turnstile-secret"))
    monkeypatch.setattr(settings, "TURNSTILE_SITE_KEY", "0x4AAAAAAA-site-key")
    monkeypatch.setattr(settings, "TURNSTILE_HOSTNAMES", HOST)
    answer: dict = {"json": {"success": True, "action": "signup", "hostname": HOST}, "calls": []}

    class FakeClient:
        def __init__(self, **_):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def post(self, url, data):
            answer["calls"].append((url, data))
            if answer.get("unreachable"):
                raise httpx.ConnectTimeout("handshake timed out")
            return httpx.Response(200, json=answer["json"], request=httpx.Request("POST", url))

    monkeypatch.setattr(turnstile.httpx, "Client", FakeClient)
    return answer


def test_the_form_learns_whether_to_ask_for_an_invite(client, invite_only):
    assert client.get("/api/auth/signup-config").json() == {"invite_required": True, "turnstile_site_key": None}


def test_the_form_learns_the_turnstile_site_key(client, siteverify):
    assert client.get("/api/auth/signup-config").json() == {
        "invite_required": False,
        "turnstile_site_key": "0x4AAAAAAA-site-key",
    }


def test_invite_only_sign_up_still_needs_the_code(client, db_session, invite_only):
    _prereqs(db_session)
    assert _sign_up(client).status_code == 403


def test_open_sign_up_needs_no_invite_with_a_good_token(client, db_session, siteverify):
    _prereqs(db_session)
    res = _sign_up(client, turnstile_token="good-token")
    assert res.status_code == 201, res.text
    url, sent = siteverify["calls"][0]
    assert url == turnstile.SITEVERIFY_URL
    assert sent["secret"] == "turnstile-secret" and sent["response"] == "good-token"
    assert db_session.query(User).filter(User.username == "openowner").count() == 1


@pytest.mark.parametrize(
    "answer",
    [
        {"success": False, "error-codes": ["timeout-or-duplicate"]},
        {"success": True, "action": "login", "hostname": HOST},
        {"success": True, "action": "signup", "hostname": "evil.example"},
    ],
    ids=["failed-or-replayed", "another-action", "another-hostname"],
)
def test_a_token_cloudflare_does_not_vouch_for_is_refused(client, db_session, siteverify, answer):
    _prereqs(db_session)
    siteverify["json"] = answer
    assert _sign_up(client, turnstile_token="bad-token").status_code == 403
    assert db_session.query(User).filter(User.username == "openowner").count() == 0


def test_no_token_never_reaches_cloudflare(client, db_session, siteverify):
    _prereqs(db_session)
    assert _sign_up(client).status_code == 403
    assert siteverify["calls"] == []


def test_an_unreachable_siteverify_refuses(client, db_session, siteverify):
    _prereqs(db_session)
    siteverify["unreachable"] = True
    assert _sign_up(client, turnstile_token="good-token").status_code == 403
