"""Characterization: the reports domain (Phase 3 target). Read-only aggregations."""


def test_pnl_shape(auth_client):
    res = auth_client.get(
        "/api/reports/pnl",
        params={
            "period_start": "2026-01-01",
            "period_end": "2026-12-31",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body.keys()) == {
        "period_start",
        "period_end",
        "revenue",
        "cost_of_goods",
        "gross_profit",
        "operating_expenses",
        "net_profit",
        "gross_margin_pct",
    }


def test_ar_aging_buckets(auth_client):
    res = auth_client.get("/api/reports/ar-aging")
    assert res.status_code == 200
    assert set(res.json().keys()) == {"current", "1_30", "31_60", "61_90", "over_90"}


def test_inventory_valuation_shape(auth_client):
    res = auth_client.get("/api/reports/inventory-valuation")
    assert res.status_code == 200
    assert set(res.json().keys()) == {"palay", "milled_rice", "byproducts"}


def test_revenue_annual_shape(auth_client):
    res = auth_client.get("/api/reports/revenue-annual")
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body) == 12
    for entry in body:
        assert set(entry.keys()) == {"month", "month_name", "revenue"}
        assert 1 <= entry["month"] <= 12
        assert isinstance(entry["revenue"], float)


def test_revenue_annual_with_year(auth_client):
    res = auth_client.get("/api/reports/revenue-annual", params={"year": 2025})
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body) == 12
    assert body[0]["month"] == 1
    assert body[11]["month"] == 12


def test_compliance_report_shape(auth_client):
    res = auth_client.get(
        "/api/reports/compliance/nfa",
        params={
            "period_start": "2026-01-01",
            "period_end": "2026-12-31",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["report_type"] == "nfa"
    assert "total_batches" in body and "total_purchases" in body
