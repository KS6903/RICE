"""Characterization: the employee number follows the employment type, and the
monthly figure is worked out from the rate."""


def _make(client, **fields):
    res = client.post("/api/employees/", json={"first_name": "A", "last_name": "B", **fields})
    assert res.status_code == 201, res.text
    return res.json()


# ── automatic employee number, by employment type ────────────────────────────


def test_employee_number_follows_employment_type_and_counts_per_type(auth_client):
    first = _make(auth_client, employment_type="regular")["employee_no"]
    second = _make(auth_client, employment_type="regular")["employee_no"]
    contractual = _make(auth_client, employment_type="contractual")["employee_no"]

    prefix, n = first.split("-")
    assert prefix == "REG" and len(n) == 4
    assert second == f"REG-{int(n) + 1:04d}"
    assert contractual.startswith("CON-")


def test_each_employment_type_has_its_own_prefix(auth_client):
    expected = {
        "monthly": "MON",
        "daily": "DLY",
        "biweekly": "BWK",
        "weekly": "WKL",
        "piece_rate": "PRC",
        "commission": "COM",
        "hourly": "HRL",
        "probationary": "PRB",
        "casual": "CAS",
    }
    for kind, prefix in expected.items():
        assert _make(auth_client, employment_type=kind)["employee_no"].startswith(f"{prefix}-"), kind


def test_employee_number_falls_back_when_the_type_is_blank_or_unknown(auth_client):
    assert _make(auth_client)["employee_no"].startswith("EMP-")
    assert _make(auth_client, employment_type="intern")["employee_no"].startswith("EMP-")


def test_a_typed_employee_number_is_kept(auth_client):
    assert _make(auth_client, employment_type="regular", employee_no="OLD-77")["employee_no"] == "OLD-77"


def test_a_blank_employee_number_is_filled_in(auth_client):
    assert _make(auth_client, employment_type="regular", employee_no="  ")["employee_no"].startswith("REG-")


def test_next_number_previews_what_the_next_employee_gets(auth_client):
    preview = auth_client.get("/api/employees/next-number", params={"employment_type": "weekly"})
    assert preview.status_code == 200, preview.text
    number = preview.json()["employee_no"]
    assert number.startswith("WKL-")
    assert _make(auth_client, employment_type="weekly")["employee_no"] == number


def test_a_number_is_not_reused_after_an_employee_is_made_inactive(auth_client):
    gone = _make(auth_client, employment_type="hourly")
    auth_client.put(f"/api/employees/{gone['id']}", json={"is_active": False})
    again = _make(auth_client, employment_type="hourly")
    assert again["employee_no"] != gone["employee_no"]


def test_changing_the_type_later_keeps_the_number(auth_client):
    e = _make(auth_client, employment_type="probationary")
    res = auth_client.put(f"/api/employees/{e['id']}", json={"employment_type": "regular"})
    assert res.json()["employee_no"] == e["employee_no"]


# ── the monthly figure is worked out from the rate ───────────────────────────


def test_monthly_salary_is_worked_out_from_the_rate_and_type(auth_client):
    cases = [
        ("daily", "500", 13000.0),  # 26 working days
        ("regular", "500", 13000.0),  # a status type: the rate is a day's pay
        ("monthly", "15000", 15000.0),
        ("biweekly", "7500", 15000.0),  # twice a month
        ("weekly", "3000", 13000.0),  # 52 weeks / 12 months
        ("hourly", "70", 14560.0),  # 8 hours x 26 days
    ]
    for kind, rate, monthly in cases:
        e = _make(auth_client, employment_type=kind, daily_rate=rate)
        assert e["monthly_salary"] == monthly, (kind, e["monthly_salary"])


def test_pay_by_output_has_no_fixed_monthly_figure(auth_client):
    for kind in ("piece_rate", "commission"):
        e = _make(auth_client, employment_type=kind, daily_rate="40")
        assert e["monthly_salary"] is None, kind


def test_a_monthly_figure_typed_over_a_rate_is_ignored(auth_client):
    e = _make(auth_client, employment_type="daily", daily_rate="500", monthly_salary="99999")
    assert e["monthly_salary"] == 13000.0


def test_a_monthly_figure_with_no_rate_is_kept(auth_client):
    e = _make(auth_client, employment_type="monthly", monthly_salary="18000")
    assert e["monthly_salary"] == 18000.0


def test_editing_the_rate_or_type_works_the_monthly_figure_again(auth_client):
    e = _make(auth_client, employment_type="daily", daily_rate="500")
    raised = auth_client.put(f"/api/employees/{e['id']}", json={"daily_rate": "600"}).json()
    assert raised["monthly_salary"] == 15600.0

    switched = auth_client.put(f"/api/employees/{e['id']}", json={"employment_type": "monthly"}).json()
    assert switched["monthly_salary"] == 600.0

    cleared = auth_client.put(f"/api/employees/{e['id']}", json={"daily_rate": None}).json()
    assert cleared["monthly_salary"] is None


def test_saving_other_fields_leaves_a_hand_entered_monthly_figure(auth_client):
    # What the profile editor sends: the whole form, rate blank, monthly as stored.
    e = _make(auth_client, employment_type="regular", monthly_salary="18000")
    res = auth_client.put(
        f"/api/employees/{e['id']}",
        json={"employment_type": "regular", "daily_rate": None, "monthly_salary": 18000, "phone": "0917"},
    )
    assert res.json()["monthly_salary"] == 18000.0
