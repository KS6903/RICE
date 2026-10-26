"""Characterization: each account keeps the language the web app shows it in.

Chosen under Settings > Appearance, saved on the account so it follows the
person to every device, and sent back with /me. Null until chosen.
"""

BEARER = {"X-Client-Type": "bearer"}


def _boss(client) -> dict:
    res = client.post("/api/auth/login", data={"username": "owner", "password": "Password123"}, headers=BEARER)
    assert res.status_code == 200, res.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_the_account_keeps_its_language(client, seed_owner):
    boss = _boss(client)
    assert client.get("/api/auth/me", headers=boss).json()["language"] is None

    for language in ("tl", "ceb", "zh-CN", None):
        res = client.put("/api/auth/language", json={"language": language}, headers=boss)
        assert res.status_code == 200, res.text
        assert res.json() == {"language": language}
        assert client.get("/api/auth/me", headers=boss).json()["language"] == language


def test_only_a_language_tag_is_kept(client, seed_owner):
    boss = _boss(client)
    for bad in ("", "english please", "<script>", "x" * 40):
        assert client.put("/api/auth/language", json={"language": bad}, headers=boss).status_code == 422
    assert client.get("/api/auth/me", headers=boss).json()["language"] is None


def test_signed_out_nobody_sets_a_language(client):
    assert client.put("/api/auth/language", json={"language": "tl"}).status_code == 401
