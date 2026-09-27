"""Characterization: the employees domain (Phase 3e target). Pins the full
serialized employee shape (incl. composed full_name) and the role gate."""

EMPLOYEE_KEYS = {
    "id",
    "company_id",
    "branch_id",
    "branch",
    "employee_no",
    "first_name",
    "middle_name",
    "last_name",
    "full_name",
    "position",
    "department",
    "employment_type",
    "date_hired",
    "date_terminated",
    "daily_rate",
    "monthly_salary",
    "phone",
    "email",
    "address",
    "birthdate",
    "gender",
    "civil_status",
    "sss_no",
    "philhealth_no",
    "pagibig_no",
    "tin",
    "emergency_contact_name",
    "emergency_contact_phone",
    "emergency_contact_relation",
    "notes",
    "is_active",
    "created_at",
}


def test_create_employee_serialized_shape(auth_client):
    res = auth_client.post(
        "/api/employees/",
        json={
            "first_name": "Juan",
            "middle_name": "D",
            "last_name": "Cruz",
            "daily_rate": "550.00",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert set(body.keys()) == EMPLOYEE_KEYS
    assert body["full_name"] == "Juan D Cruz"
    assert body["is_active"] is True
    assert body["daily_rate"] == 550.0


def test_list_and_get_employee(auth_client):
    created = auth_client.post("/api/employees/", json={"first_name": "Ana", "last_name": "Reyes"}).json()
    eid = created["id"]
    rows = auth_client.get("/api/employees/").json()
    assert any(r["id"] == eid for r in rows)
    one = auth_client.get(f"/api/employees/{eid}").json()
    assert one["id"] == eid
    assert one["full_name"] == "Ana Reyes"


def test_get_unknown_employee_404(auth_client):
    res = auth_client.get("/api/employees/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404


def test_create_employee_denied_for_cashier(make_auth_client):
    c = make_auth_client(features=["employees"], username="cash", role_name="cashier")
    res = c.post("/api/employees/", json={"first_name": "X", "last_name": "Y"})
    assert res.status_code == 403
