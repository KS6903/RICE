"""Settings > Feedback: a rating and why, read by BossAdmin across the mills."""

from __future__ import annotations


def test_a_rating_with_its_reasons_reaches_bossadmin(auth_client, admin_client):
    assert auth_client.get("/api/feedback").json() is None

    res = auth_client.post(
        "/api/feedback",
        json={"rating": 2, "reasons": ["too_slow", "other"], "other_text": "  Printing the receipt fails.  "},
    )
    assert res.status_code == 201, res.text
    assert auth_client.get("/api/feedback").json()["rating"] == 2

    auth_client.post("/api/feedback", json={"rating": 5, "reasons": ["saves_time"]})

    page = admin_client.get("/api/admin/feedback").json()
    assert page["summary"]["count"] == 2
    assert page["summary"]["average"] == 3.5
    assert page["summary"]["by_rating"] == {"1": 0, "2": 1, "3": 0, "4": 0, "5": 1}
    assert {r["code"]: r["count"] for r in page["summary"]["reasons"]} == {"too_slow": 1, "other": 1, "saves_time": 1}
    assert [item["rating"] for item in page["items"]] == [5, 2]
    assert page["items"][1]["other_text"] == "Printing the receipt fails."
    assert page["items"][1]["company_name"]
    assert page["items"][1]["user_name"]

    low = admin_client.get("/api/admin/feedback", params={"rating": 2}).json()
    assert [item["rating"] for item in low["items"]] == [2]
    assert low["summary"]["count"] == 2  # the summary stays the whole picture


def test_the_reason_must_fit_the_rating_and_other_must_say_why(auth_client):
    send = lambda **body: auth_client.post("/api/feedback", json=body).status_code  # noqa: E731
    assert send(rating=5, reasons=["too_slow"]) == 400
    assert send(rating=1, reasons=["saves_time"]) == 400
    assert send(rating=3, reasons=["made_up"]) == 400
    assert send(rating=3, reasons=["other"], other_text="   ") == 400
    assert send(rating=3, reasons=[]) == 422
    assert send(rating=6, reasons=["other"], other_text="x") == 422
    assert send(rating=3, reasons=["other"], other_text="Needs a Bisaya receipt.") == 201


def test_only_bossadmin_reads_everyones_feedback(auth_client):
    assert auth_client.get("/api/admin/feedback").status_code == 403
