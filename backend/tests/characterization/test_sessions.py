"""Active-session management (security hardening — phase 5).

Each login is a session/device (an auth_sessions family). Users can list their
own sessions, revoke one (e.g. a lost device), or sign out all others; the
current session is flagged and protected by revoke-others. Sessions are
per-user — one user can't see or revoke another's.
"""


def _login(client, ua="Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537"):
    res = client.post(
        "/api/auth/login",
        data={"username": "owner", "password": "Password123"},
        headers={"User-Agent": ua},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _auth(tokens) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def test_list_shows_current_session_with_device_label(client, seed_owner):
    tokens = _login(client)
    client.cookies.clear()
    res = client.get("/api/auth/sessions", headers=_auth(tokens))
    assert res.status_code == 200
    sessions = res.json()
    assert len(sessions) == 1
    assert sessions[0]["current"] is True
    assert sessions[0]["client"] == "Chrome · Windows"


def test_multiple_logins_listed_then_revoke_one(client, seed_owner):
    a = _login(client, ua="Mozilla/5.0 (Macintosh) Safari/605")
    client.cookies.clear()
    b = _login(client, ua="Mozilla/5.0 (Windows NT 10.0) Chrome/120")
    client.cookies.clear()

    # From device B, both sessions are visible; B is current.
    sessions = client.get("/api/auth/sessions", headers=_auth(b)).json()
    assert len(sessions) == 2
    by_current = {s["current"]: s for s in sessions}
    other_id = by_current[False]["id"]

    # Revoke the other (device A).
    assert client.delete(f"/api/auth/sessions/{other_id}", headers=_auth(b)).status_code == 200
    # A's refresh token no longer works…
    assert client.post("/api/auth/refresh", json={"refresh_token": a["refresh_token"]}).status_code == 401
    # …and only B remains listed.
    remaining = client.get("/api/auth/sessions", headers=_auth(b)).json()
    assert len(remaining) == 1 and remaining[0]["current"] is True


def test_revoke_others_keeps_current(client, seed_owner):
    a = _login(client)
    client.cookies.clear()
    b = _login(client)
    client.cookies.clear()

    res = client.post("/api/auth/sessions/revoke-others", headers=_auth(b))
    assert res.status_code == 200
    assert res.json()["revoked"] == 1

    # Current (B) still works; A is gone.
    assert client.get("/api/auth/sessions", headers=_auth(b)).status_code == 200
    assert client.post("/api/auth/refresh", json={"refresh_token": a["refresh_token"]}).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": b["refresh_token"]}).status_code == 200


def test_cannot_revoke_another_users_session(client, seed_owner, db_session):
    import jwt

    from app.core.security import hash_password
    from app.models.user import User

    # A second real user, reusing the seeded owner's role/company.
    attacker = User(
        company_id=seed_owner.company_id, branch_id=seed_owner.branch_id,
        username="attacker", email="attacker@test.local",
        password_hash=hash_password("Password123"), full_name="Attacker",
        role_id=seed_owner.role_id, is_active=True,
    )
    db_session.add(attacker)
    db_session.flush()

    # Victim (seeded owner) logs in for real.
    victim = _login(client)
    client.cookies.clear()
    victim_sid = jwt.decode(victim["access_token"], options={"verify_signature": False})["sid"]

    atk = client.post(
        "/api/auth/login", data={"username": "attacker", "password": "Password123"}
    ).json()
    client.cookies.clear()

    # Attacker tries to revoke the victim's session → 404 (reads as not-found,
    # never forbidden — doesn't confirm the id exists).
    assert client.delete(f"/api/auth/sessions/{victim_sid}", headers=_auth(atk)).status_code == 404
    # The victim's session is untouched.
    assert client.post("/api/auth/refresh", json={"refresh_token": victim["refresh_token"]}).status_code == 200
