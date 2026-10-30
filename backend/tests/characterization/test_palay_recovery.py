"""A milling-recovery test on a palay purchase: a sample weighed in and what came out
of it. It is saved on the purchase (kept when the purchase's lines are corrected),
works out the recovery and head-rice percentages itself, moves no stock, and is
logged in the purchase's history."""

from __future__ import annotations

from app.models.paddy import PalayInventory

SOME_ID = "00000000-0000-0000-0000-000000000001"


def _ok(res, code=200):
    assert res.status_code == code, res.text
    return res.json()


def _variety(c, code="RC400"):
    return _ok(c.post("/api/paddy/varieties", json={"code": code, "name": f"NSIC {code}"}), 201)


def _buy(c, variety):
    line = {"variety_id": variety["id"], "gross_weight_kg": "1000", "price_per_cavan": "1200"}
    return _ok(c.post("/api/paddy/purchases", json={"purchase_date": "2026-10-30", "items": [line]}), 201)


def _test(variety, **over):
    return {
        "variety_id": variety["id"],
        "sample_kg": "100",
        "sample_moisture_pct": "14",
        "milled_kg": "65",
        "head_rice_kg": "52",
        "husk_kg": "20",
        "bran_kg": "10",
        **over,
    }


def _history(c, purchase):
    return _ok(c.get(f"/api/paddy/history/palay_purchase/{purchase['id']}"))


def test_a_recovery_test_works_out_its_percentages_and_moves_no_stock(auth_client, db_session):
    variety = _variety(auth_client)
    purchase = _buy(auth_client, variety)

    done = _ok(auth_client.post(f"/api/paddy/purchases/{purchase['id']}/recovery", json=_test(variety)))

    [test] = done["recovery_tests"]
    assert float(test["recovery_pct"]) == 65
    assert float(test["head_rice_pct"]) == 52
    assert float(test["sample_kg"]) == 100
    assert test["variety_code"] == "RC400"
    assert test["created_by_name"] == "Test Owner"
    # The purchase list carries it too.
    [listed] = _ok(auth_client.get("/api/paddy/purchases"))
    assert [t["id"] for t in listed["recovery_tests"]] == [test["id"]]
    # Only how the palay milled is recorded: the stock is as bought.
    assert float(db_session.query(PalayInventory).one().quantity_kg) == 1000

    [entry] = _history(auth_client, purchase)
    assert entry["action"] == "palay_purchase.recovery"
    assert entry["detail"] == "RC400: 65 kg of milled rice from 100 kg of palay, 65% recovery, 52% head rice"


def test_the_head_rice_husk_bran_and_moisture_are_optional(auth_client):
    variety = _variety(auth_client)
    purchase = _buy(auth_client, variety)

    done = _ok(
        auth_client.post(
            f"/api/paddy/purchases/{purchase['id']}/recovery",
            json={"sample_kg": "40", "milled_kg": "25.5"},
        )
    )

    [test] = done["recovery_tests"]
    assert float(test["recovery_pct"]) == 63.75
    assert test["head_rice_pct"] is None
    assert test["variety_code"] is None
    assert test["sample_moisture_pct"] is None


def test_a_test_that_cannot_add_up_is_refused(auth_client):
    variety = _variety(auth_client)
    purchase = _buy(auth_client, variety)
    url = f"/api/paddy/purchases/{purchase['id']}/recovery"

    more_rice_than_palay = auth_client.post(url, json=_test(variety, milled_kg="101"))
    assert more_rice_than_palay.status_code == 422
    assert "can't weigh more than the palay" in more_rice_than_palay.text

    more_head_than_rice = auth_client.post(url, json=_test(variety, head_rice_kg="66"))
    assert more_head_than_rice.status_code == 422
    assert "part of the milled rice" in more_head_than_rice.text

    assert auth_client.post(url, json=_test(variety, sample_kg="0")).status_code == 422
    assert auth_client.post(url, json=_test(variety, sample_moisture_pct="101")).status_code == 422
    assert _ok(auth_client.get("/api/paddy/purchases"))[0]["recovery_tests"] == []


def test_correcting_the_purchase_lines_keeps_its_recovery_tests(auth_client):
    variety = _variety(auth_client)
    purchase = _buy(auth_client, variety)
    _ok(auth_client.post(f"/api/paddy/purchases/{purchase['id']}/recovery", json=_test(variety)))

    line = {"variety_id": variety["id"], "gross_weight_kg": "1200", "price_per_cavan": "1200"}
    edited = _ok(auth_client.patch(f"/api/paddy/purchases/{purchase['id']}", json={"items": [line]}))

    assert edited["total_kg"] == 1200.0
    [test] = edited["recovery_tests"]
    assert float(test["recovery_pct"]) == 65


def test_a_test_taken_off_is_logged_and_gone(auth_client):
    variety = _variety(auth_client)
    purchase = _buy(auth_client, variety)
    [test] = _ok(auth_client.post(f"/api/paddy/purchases/{purchase['id']}/recovery", json=_test(variety)))[
        "recovery_tests"
    ]

    gone = _ok(auth_client.delete(f"/api/paddy/purchases/{purchase['id']}/recovery/{test['id']}"))

    assert gone["recovery_tests"] == []
    assert {e["action"] for e in _history(auth_client, purchase)} == {
        "palay_purchase.recovery",
        "palay_purchase.recovery_removed",
    }
    missing = auth_client.delete(f"/api/paddy/purchases/{purchase['id']}/recovery/{test['id']}")
    assert missing.status_code == 404


def test_only_edit_power_takes_a_test_off(make_auth_client):
    # The accountant sees the Buy pages but has no edit power.
    accountant = make_auth_client(["paddy"], username="books", role_name="accountant")
    res = accountant.delete(f"/api/paddy/purchases/{SOME_ID}/recovery/{SOME_ID}")
    assert res.status_code == 403
    assert "edit power" in res.json()["detail"]


def test_another_mills_purchase_takes_no_recovery_test(make_auth_client):
    theirs = make_auth_client(["paddy"], username="theirs")
    line = {"gross_weight_kg": "100", "price_per_cavan": "1000"}
    purchase = _ok(theirs.post("/api/paddy/purchases", json={"purchase_date": "2026-10-30", "items": [line]}), 201)

    mine = make_auth_client(["paddy"], username="mine")
    res = mine.post(f"/api/paddy/purchases/{purchase['id']}/recovery", json={"sample_kg": "40", "milled_kg": "25"})

    assert res.status_code == 404
