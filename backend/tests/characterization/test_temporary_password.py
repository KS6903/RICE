"""Getting back in after a lockout: a temporary password from the Boss or the admin.

An employee who is locked out goes to the Boss, who gives them a temporary
password. The Boss, locked out, emails the platform admin, who gives them one. A
temporary password replaces the real one, unlocks the account, signs the person out
everywhere, expires, and has to be swapped for one of their own at first sign-in
before anything else works.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import app.services.auth_service as asvc
import app.services.platform_emails as emails
from app.core.passwords import generate_temporary_password, validate_password_strength
from app.core.ratelimit import LockoutState
from app.core.security import get_current_user, hash_password
from app.main import app
from app.models.auth_session import AuthSession
from app.models.company import Company
from app.models.user import Role, User

PASSWORD = "Password123"


def _staff(db_session, boss: User, username="cashier1", role_id=2, **extra) -> User:
    """A member of the Boss's own staff (role 2 is the admin role in these tests)."""
    user = User(
        company_id=boss.company_id,
        branch_id=boss.branch_id,
        username=username,
        email=f"{username}@test.local",
        password_hash=hash_password(PASSWORD),
        full_name=f"Staff {username}",
        role_id=role_id,
        is_active=True,
        **extra,
    )
    db_session.add(user)
    db_session.flush()
    return user


def _issue(auth_client, user):
    return auth_client.post(f"/api/users/{user.id}/temporary-password")


def _sign_in(client, username, password):
    return client.post("/api/auth/login", data={"username": username, "password": password})


@pytest.fixture
def sent(monkeypatch):
    """Every email the app tries to send: (to, subject, text)."""
    mails: list[tuple[str | None, str, str]] = []
    monkeypatch.setattr(emails, "send_account_email", lambda to, subject, text: mails.append((to, subject, text)))
    return mails


# ── the password itself ──────────────────────────────────────────────────────


def test_a_generated_temporary_password_passes_the_policy_and_is_easy_to_read_out():
    seen = {generate_temporary_password() for _ in range(200)}
    assert len(seen) == 200  # not repeating
    for password in seen:
        validate_password_strength(password)
        groups = password.split("-")
        assert [len(g) for g in groups] == [4, 4, 4]
        assert not set(password) & set("ilo01")  # nothing to misread
        assert any(c.islower() for c in password) and any(c.isupper() for c in password)
        assert any(c.isdigit() for c in password)


# ── the Boss and an employee ─────────────────────────────────────────────────


def test_the_boss_gives_a_locked_out_employee_a_temporary_password(auth_client, db_session, seed_owner, sent):
    staff = _staff(db_session, seed_owner)
    res = _issue(auth_client, staff)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["username"] == "cashier1" and body["expires_at"]
    assert res.headers["Cache-Control"] == "no-store"  # shown once, never cached

    # It replaced the old password, and the person must choose their own.
    db_session.refresh(staff)
    assert staff.must_change_password is True
    assert staff.temp_password_expires_at is not None
    from app.core.security import verify_password

    assert verify_password(body["temporary_password"], staff.password_hash)
    assert not verify_password(PASSWORD, staff.password_hash)

    # They are told it happened, but the password itself is never emailed.
    [(to, subject, text)] = sent
    assert to == "cashier1@test.local" and "temporary password" in subject
    assert body["temporary_password"] not in text and "Test Owner" in text


def test_issuing_one_unlocks_the_account_and_signs_the_person_out_everywhere(
    auth_client, db_session, seed_owner, monkeypatch
):
    staff = _staff(db_session, seed_owner)
    cleared = []
    monkeypatch.setattr(asvc, "clear_login_failures", lambda username: cleared.append(username))
    session = AuthSession(
        family_id=staff.id,
        user_id=staff.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db_session.add(session)
    db_session.flush()

    assert _issue(auth_client, staff).status_code == 200
    assert cleared == ["cashier1"]  # a lockout is what this is for
    db_session.refresh(session)
    assert session.revoked_at is not None


def test_signing_in_on_a_temporary_password_blocks_the_app_until_a_new_one_is_chosen(
    client, auth_client, db_session, seed_owner
):
    staff = _staff(db_session, seed_owner)
    temporary = _issue(auth_client, staff).json()["temporary_password"]

    app.dependency_overrides.pop(get_current_user, None)  # from here on, real sign-in
    assert _sign_in(client, "cashier1", PASSWORD).status_code == 401  # the old one is gone
    assert _sign_in(client, "cashier1", temporary).json() == {"authenticated": True}

    me = client.get("/api/auth/me").json()
    assert me["password_change_required"] is True
    blocked = client.get("/api/users/")
    assert blocked.status_code == 403
    assert "new password" in blocked.json()["detail"]


def test_choosing_their_own_password_ends_the_temporary_one(auth_client, db_session, seed_owner):
    staff = _staff(db_session, seed_owner)
    temporary = _issue(auth_client, staff).json()["temporary_password"]
    db_session.refresh(staff)

    svc = asvc.AuthService(db_session, staff)
    # The new password has to be a different one.
    with pytest.raises(Exception, match="different from the temporary one"):
        svc.change_password(SimpleNamespace(current_password=temporary, new_password=temporary))
    assert staff.must_change_password is True

    svc.change_password(SimpleNamespace(current_password=temporary, new_password="My-own-Pass-77"))
    assert staff.must_change_password is False and staff.temp_password_expires_at is None


def test_the_temporary_password_stops_working_when_it_expires(client, auth_client, db_session, seed_owner):
    staff = _staff(db_session, seed_owner)
    temporary = _issue(auth_client, staff).json()["temporary_password"]
    staff.temp_password_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.flush()

    res = _sign_in(client, "cashier1", temporary)
    assert res.status_code == 401
    assert "temporary password has expired" in res.json()["detail"]


def test_only_the_boss_can_give_one(auth_client, db_session, seed_owner):
    staff = _staff(db_session, seed_owner, "cashier1")
    other = _staff(db_session, seed_owner, "cashier2")
    app.dependency_overrides[get_current_user] = lambda: staff  # an admin, not the Boss
    res = _issue(auth_client, other)
    assert res.status_code == 403
    assert "Only the Boss" in res.json()["detail"]
    db_session.refresh(other)
    assert other.must_change_password is False


def test_the_boss_cannot_do_it_for_themselves_for_a_removed_user_or_for_another_mill(
    auth_client, db_session, seed_owner, make_auth_client
):
    assert _issue(auth_client, seed_owner).status_code == 400  # their own: use Settings

    gone = _staff(db_session, seed_owner, "gone1", is_platform_admin=False)
    gone.is_active = False
    db_session.flush()
    assert _issue(auth_client, gone).status_code == 400

    # A user of a different mill is not theirs to reset: indistinguishable from none.
    foreign = db_session.query(User).filter(User.id != seed_owner.id)
    assert foreign.count() == 1  # only the one just removed
    other_mill = Company(name="Someone Else's Mill")
    db_session.add(other_mill)
    db_session.flush()
    stranger = User(
        company_id=other_mill.id,
        username="stranger",
        email="stranger@test.local",
        password_hash=hash_password(PASSWORD),
        full_name="Stranger",
        role_id=2,
        is_active=True,
    )
    db_session.add(stranger)
    db_session.flush()
    assert _issue(auth_client, stranger).status_code == 404
    db_session.refresh(stranger)
    assert stranger.must_change_password is False


# ── the platform admin and a locked-out Boss ─────────────────────────────────


def _boss_of_the_admins_mill(db_session) -> User:
    admin = db_session.query(User).filter(User.is_platform_admin.is_(True)).one()
    owner_role = db_session.query(Role).filter(Role.name == "owner").one()
    boss = User(
        company_id=admin.company_id,
        branch_id=admin.branch_id,
        username="theboss",
        email="theboss@test.local",
        password_hash=hash_password(PASSWORD),
        full_name="The Boss",
        role_id=owner_role.id,
        is_active=True,
    )
    db_session.add(boss)
    db_session.flush()
    return boss


def test_the_platform_admin_gives_a_locked_out_boss_a_temporary_password(admin_client, db_session, sent):
    boss = _boss_of_the_admins_mill(db_session)
    res = admin_client.post(f"/api/admin/users/{boss.id}/temporary-password")
    assert res.status_code == 200, res.text
    assert res.headers["Cache-Control"] == "no-store"
    db_session.refresh(boss)
    assert boss.must_change_password is True
    assert [to for to, _, _ in sent] == ["theboss@test.local"]
    assert res.json()["temporary_password"] not in sent[0][2]


def test_a_platform_admin_account_is_not_reset_through_this(admin_client, db_session):
    admin = db_session.query(User).filter(User.is_platform_admin.is_(True)).one()
    assert admin_client.post(f"/api/admin/users/{admin.id}/temporary-password").status_code == 404


def test_only_a_platform_admin_can_use_the_admin_endpoint(auth_client, db_session, seed_owner):
    staff = _staff(db_session, seed_owner)
    res = auth_client.post(f"/api/admin/users/{staff.id}/temporary-password")
    assert res.status_code == 403
    db_session.refresh(staff)
    assert staff.must_change_password is False


# ── the locked-out Boss asking for it ────────────────────────────────────────

ANSWER = "If that is a locked Boss account, the admin has been told and will contact you."


class _Asks(list):
    """The (username, company, message) of each email to the admin; ``first`` is
    what the once-an-hour throttle will answer."""

    def __init__(self) -> None:
        super().__init__()
        self.first = {"yes": True}


@pytest.fixture
def asks(monkeypatch):
    """Record the emails to the admin; the account counts as locked, once an hour."""
    calls = _Asks()
    monkeypatch.setattr(asvc, "login_lockout", lambda username: LockoutState(True, False, 600))
    monkeypatch.setattr(asvc, "first_lockout_help_request", lambda username: calls.first["yes"])
    monkeypatch.setattr(
        asvc.platform_emails,
        "lockout_help_requested",
        lambda db, user, state, *, company, message: calls.append((user.username, company, message)) or 1,
    )
    return calls


def _ask(client, username, message=None):
    body = {"username": username}
    if message is not None:
        body["message"] = message
    return client.post("/api/auth/lockout-help", json=body)


def test_a_locked_out_boss_can_email_the_admin(client, seed_owner, asks):
    res = _ask(client, "owner", "I forgot it after the holiday")
    assert res.status_code == 200 and res.json() == {"message": ANSWER}
    assert asks == [("owner", "Test Mill", "I forgot it after the holiday")]


def test_the_message_is_tidied_and_capped(client, seed_owner, asks):
    assert _ask(client, "owner", "line one\n\n   line   two\r\n" + "x" * 450).status_code == 200
    [(_, _, message)] = asks
    assert message.startswith("line one line two xxx") and len(message) == 300
    assert "\n" not in message
    # Anything past 500 characters is refused outright.
    assert _ask(client, "owner", "x" * 501).status_code == 422
    assert len(asks) == 1


def test_the_answer_never_says_whether_an_account_exists(client, db_session, seed_owner, asks, monkeypatch):
    staff = _staff(db_session, seed_owner)
    answers = {
        "no such user": _ask(client, "nobody-at-all").json(),
        "an employee": _ask(client, staff.username).json(),  # employees ask their Boss
        "a Boss": _ask(client, "owner").json(),
    }
    assert set(map(str, answers.values())) == {str({"message": ANSWER})}
    assert [c[0] for c in asks] == ["owner"]  # only the Boss's request reached the admin

    # And not when the Boss isn't locked out at all.
    asks.clear()
    monkeypatch.setattr(asvc, "login_lockout", lambda username: LockoutState(False, False, 0))
    assert _ask(client, "owner").json() == {"message": ANSWER}
    assert asks == []


def test_a_boss_can_only_ask_once_an_hour(client, seed_owner, asks):
    assert _ask(client, "owner").status_code == 200
    asks.first["yes"] = False  # the throttle has seen this account already
    assert _ask(client, "owner").json() == {"message": ANSWER}
    assert len(asks) == 1


def test_a_platform_admin_or_removed_boss_is_not_emailed_about(client, db_session, seed_owner, asks):
    seed_owner.is_active = False
    db_session.flush()
    assert _ask(client, "owner").status_code == 200
    assert asks == []


def test_the_email_to_the_admin_names_the_boss_and_the_mill_and_asks_for_a_check(db_session, seed_owner, sent):
    admin = User(
        username="op",
        email="op@test.local",
        password_hash="x",
        full_name="Operator",
        is_platform_admin=True,
        is_active=True,
    )
    db_session.add(admin)
    db_session.flush()
    count = emails.lockout_help_requested(
        db_session, seed_owner, LockoutState(True, True, 0), company="Test Mill", message="please help"
    )
    assert count == 1
    [(to, subject, text)] = sent
    assert to == "op@test.local" and "Test Mill" in subject
    assert "Test Owner" in text and "please help" in text and "permanently" in text
    assert "check it is really them" in text and "/admin/users" in text
