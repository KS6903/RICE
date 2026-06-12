"""Cookie-session auth + CSRF double-submit (security hardening P0.4).

The web SPA authenticates via httpOnly cookies (XSS can't read the tokens) and
must echo the readable ``csrf_token`` cookie as ``X-CSRF-Token`` on mutating
requests. Bearer clients (Authorization header) bypass cookies and CSRF
entirely — that path is covered by the existing auth tests.
"""

LOGIN = {"username": "owner", "password": "Password123"}


def _login(client):
    res = client.post("/api/auth/login", data=LOGIN)
    assert res.status_code == 200, res.text
    return res


def _csrf_header(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("csrf_token")}


def test_login_sets_httponly_session_cookies(client, seed_owner):
    res = _login(client)
    cookies = {c.split("=", 1)[0]: c for c in res.headers.get_list("set-cookie")}

    assert "access_token" in cookies and "HttpOnly" in cookies["access_token"]
    assert "refresh_token" in cookies and "HttpOnly" in cookies["refresh_token"]
    # The refresh token only travels to the auth endpoints.
    assert "Path=/api/auth" in cookies["refresh_token"]
    # The CSRF cookie must be readable by the SPA (double submit), so NOT httpOnly.
    assert "csrf_token" in cookies and "HttpOnly" not in cookies["csrf_token"]
    for c in cookies.values():
        assert "SameSite=strict" in c


def test_cookie_auth_works_for_reads_without_bearer_header(client, seed_owner):
    _login(client)
    res = client.get("/api/auth/me")  # no Authorization header — cookie only
    assert res.status_code == 200
    assert res.json()["username"] == "owner"


def test_cookie_mutation_without_csrf_header_is_403(client, seed_owner):
    _login(client)
    res = client.put("/api/auth/me", json={"full_name": "Hacked Name"})
    assert res.status_code == 403


def test_cookie_mutation_with_csrf_header_succeeds(client, seed_owner):
    _login(client)
    res = client.put("/api/auth/me", json={"full_name": "New Name"}, headers=_csrf_header(client))
    assert res.status_code == 200


def test_cookie_refresh_requires_csrf(client, seed_owner):
    _login(client)
    assert client.post("/api/auth/refresh").status_code == 403  # no CSRF header
    res = client.post("/api/auth/refresh", headers=_csrf_header(client))
    assert res.status_code == 200
    assert res.json()["access_token"]


def test_cookie_logout_revokes_and_clears(client, seed_owner):
    _login(client)
    res = client.post("/api/auth/logout", headers=_csrf_header(client))
    assert res.status_code == 200

    # Session cookies are gone — a cookie-based refresh has nothing to send.
    assert client.cookies.get("access_token", None) is None
    assert client.post("/api/auth/refresh").status_code == 401


def test_no_credentials_is_401(client, seed_owner):
    assert client.get("/api/auth/me").status_code == 401
