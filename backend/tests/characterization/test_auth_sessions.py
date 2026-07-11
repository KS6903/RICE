"""Refresh-session rotation & revocation (security hardening P0.5).

Refresh tokens are stateful (auth_sessions rows): rotated on every /refresh,
revoked on logout and password change, with reuse-detection that kills the
whole token family. The access-token Redis blocklist is best-effort and not
exercised here (Redis is disabled in tests); these tests cover the durable
Postgres-backed guarantees.
"""

NATIVE_HEADERS = {"X-Client-Type": "bearer", "User-Agent": "Electron/Test"}


def _login(client):
    res = client.post("/api/auth/login", data={"username": "owner", "password": "Password123"}, headers=NATIVE_HEADERS)
    assert res.status_code == 200, res.text
    # The TestClient shares one cookie jar; these tests model independent
    # bearer-token devices, so drop the session cookies the login just set
    # (otherwise a later request would implicitly carry another "device's"
    # session and logout would correctly-but-confusingly revoke it too).
    client.cookies.clear()
    return res.json()


def test_refresh_rotates_the_refresh_token(client, seed_owner):
    tokens = _login(client)
    res = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}, headers=NATIVE_HEADERS)
    assert res.status_code == 200
    assert res.json()["refresh_token"] != tokens["refresh_token"]


def test_refresh_token_reuse_revokes_the_family(client, seed_owner):
    tokens = _login(client)
    first = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}, headers=NATIVE_HEADERS)
    assert first.status_code == 200
    successor = first.json()["refresh_token"]

    # Replaying the original (already-rotated) token must be rejected…
    reuse = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}, headers=NATIVE_HEADERS)
    assert reuse.status_code == 401

    # …and must also kill the successor (whole family revoked — theft response).
    after = client.post("/api/auth/refresh", json={"refresh_token": successor}, headers=NATIVE_HEADERS)
    assert after.status_code == 401


def test_logout_revokes_the_refresh_session(client, seed_owner):
    tokens = _login(client)
    res = client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert res.status_code == 200

    refreshed = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}, headers=NATIVE_HEADERS)
    assert refreshed.status_code == 401


def test_logout_does_not_kill_other_devices(client, seed_owner):
    device_a = _login(client)
    device_b = _login(client)
    res = client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {device_a['access_token']}"},
    )
    assert res.status_code == 200

    # Device A's chain is dead; device B's separate family still works.
    assert client.post("/api/auth/refresh", json={"refresh_token": device_a["refresh_token"]}, headers=NATIVE_HEADERS).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": device_b["refresh_token"]}, headers=NATIVE_HEADERS).status_code == 200


def test_password_change_revokes_all_sessions(client, seed_owner):
    device_a = _login(client)
    device_b = _login(client)
    res = client.post(
        "/api/auth/change-password",
        json={"current_password": "Password123", "new_password": "newpassword1"},
        headers={"Authorization": f"Bearer {device_a['access_token']}"},
    )
    assert res.status_code == 200, res.text

    # Every refresh chain for the user is revoked, both devices must re-login.
    assert client.post("/api/auth/refresh", json={"refresh_token": device_a["refresh_token"]}, headers=NATIVE_HEADERS).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": device_b["refresh_token"]}, headers=NATIVE_HEADERS).status_code == 401
