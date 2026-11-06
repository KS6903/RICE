"""Settings > Feedback: a rating and why, kept for the sender's tab and posted to
the platform owner's Discord."""

from __future__ import annotations

from pydantic import SecretStr

from app.core import discord
from app.core.config import settings

WEBHOOK = "https://discord.com/api/webhooks/123/abc"


def test_a_rating_with_its_reasons_goes_to_discord(make_auth_client, monkeypatch):
    sent: list[tuple[str, dict]] = []
    monkeypatch.setattr(settings, "DISCORD_FEEDBACK_WEBHOOK_URL", SecretStr(WEBHOOK))
    monkeypatch.setattr(discord, "_post", lambda url, payload: sent.append((url, payload)))
    monkeypatch.setattr(
        discord.threading,
        "Thread",
        lambda target, args, **_: type("T", (), {"start": lambda self: target(*args)})(),
    )
    auth_client = make_auth_client(features=[], username="boss")
    assert auth_client.get("/api/feedback").json() is None

    res = auth_client.post(
        "/api/feedback",
        json={"rating": 2, "reasons": ["too_slow", "other"], "other_text": "  Printing the receipt fails. @everyone "},
    )
    assert res.status_code == 201, res.text
    assert auth_client.get("/api/feedback").json()["rating"] == 2

    assert len(sent) == 1
    url, payload = sent[0]
    assert url == WEBHOOK
    assert payload["allowed_mentions"] == {"parse": []}
    card = payload["embeds"][0]
    assert card["title"].endswith("2/5, Poor")
    fields = {f["name"]: f["value"] for f in card["fields"]}
    assert "Too slow" in fields["Why"] and "Other" in fields["Why"]
    assert fields["In their words"] == "Printing the receipt fails. @everyone"
    assert "@boss" in fields["From"]


def test_no_webhook_means_nothing_is_sent(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "DISCORD_FEEDBACK_WEBHOOK_URL", None)
    called = []
    monkeypatch.setattr(discord, "_post", lambda *a: called.append(a))
    assert auth_client.post("/api/feedback", json={"rating": 5, "reasons": ["saves_time"]}).status_code == 201
    assert called == []


def test_only_a_discord_address_is_used(monkeypatch):
    assert discord.webhook_ok(WEBHOOK)
    for bad in (
        "http://discord.com/api/webhooks/1/a",
        "https://evil.example/api/webhooks/1/a",
        "https://discord.com.evil.example/api/webhooks/1/a",
        "https://discord.com:8443/api/webhooks/1/a",
        "https://discord.com/users/1",
    ):
        assert not discord.webhook_ok(bad), bad


def test_the_reason_must_fit_the_rating_and_other_must_say_why(auth_client):
    send = lambda **body: auth_client.post("/api/feedback", json=body).status_code  # noqa: E731
    assert send(rating=5, reasons=["too_slow"]) == 400
    assert send(rating=1, reasons=["saves_time"]) == 400
    assert send(rating=3, reasons=["made_up"]) == 400
    assert send(rating=3, reasons=["other"], other_text="   ") == 400
    assert send(rating=3, reasons=[]) == 422
    assert send(rating=6, reasons=["other"], other_text="x") == 422
    assert send(rating=3, reasons=["other"], other_text="Needs a Bisaya receipt.") == 201


def test_bossadmin_has_no_feedback_page_any_more(make_auth_client):
    admin_client = make_auth_client(features=[], username="admin", is_platform_admin=True)
    assert admin_client.get("/api/admin/feedback").status_code == 404
