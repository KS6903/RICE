"""Characterization: how an employee's salary is paid, and the details each
method needs."""


def _post(client, **fields):
    return client.post("/api/employees/", json={"first_name": "Ana", "last_name": "Reyes", **fields})


def test_cash_needs_no_details_and_drops_any_sent(auth_client):
    res = _post(auth_client, pay_method="cash", pay_provider="BDO", pay_account_no="123456")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["pay_method"] == "cash"
    assert (body["pay_provider"], body["pay_account_name"], body["pay_account_no"]) == (None, None, None)


def test_a_bank_transfer_needs_the_bank_and_the_account_number(auth_client):
    ok = _post(
        auth_client,
        pay_method="bank_transfer",
        pay_provider="BDO",
        pay_account_name="Ana M. Reyes",
        pay_account_no="0012 3456 7890",
    )
    assert ok.status_code == 201, ok.text
    body = ok.json()
    assert (body["pay_provider"], body["pay_account_name"], body["pay_account_no"]) == (
        "BDO",
        "Ana M. Reyes",
        "0012 3456 7890",
    )

    no_bank = _post(auth_client, pay_method="bank_transfer", pay_account_no="123456")
    assert no_bank.status_code == 400
    assert "bank name" in no_bank.json()["detail"]

    no_number = _post(auth_client, pay_method="bank_transfer", pay_provider="BDO")
    assert no_number.status_code == 400
    assert "account number" in no_number.json()["detail"]


def test_the_account_holder_defaults_to_the_employee(auth_client):
    body = _post(auth_client, pay_method="bank_transfer", pay_provider="BPI", pay_account_no="9876543210").json()
    assert body["pay_account_name"] == "Ana Reyes"


def test_an_account_number_has_only_numbers_spaces_and_dashes(auth_client):
    res = _post(auth_client, pay_method="bank_transfer", pay_provider="BDO", pay_account_no="ABC-123")
    assert res.status_code == 400
    assert "numbers" in res.json()["detail"]


def test_an_e_wallet_needs_the_provider_and_the_mobile_number(auth_client):
    ok = _post(auth_client, pay_method="e_wallet", pay_provider="GCash", pay_account_no="0917 555 0101")
    assert ok.status_code == 201, ok.text
    assert ok.json()["pay_account_no"] == "0917 555 0101"

    missing = _post(auth_client, pay_method="e_wallet", pay_provider="GCash")
    assert missing.status_code == 400
    assert "account number" in missing.json()["detail"]


def test_a_payroll_card_needs_the_issuer_and_the_card_number(auth_client):
    ok = _post(auth_client, pay_method="payroll_card", pay_provider="Landbank", pay_account_no="4000 1234 5678")
    assert ok.status_code == 201, ok.text
    assert _post(auth_client, pay_method="payroll_card", pay_provider="Landbank").status_code == 400


def test_a_check_is_made_out_to_the_employee_unless_another_payee_is_given(auth_client):
    assert _post(auth_client, pay_method="check").json()["pay_account_name"] == "Ana Reyes"
    other = _post(auth_client, pay_method="check", pay_account_name="Rosa Reyes").json()
    assert other["pay_account_name"] == "Rosa Reyes"
    assert other["pay_provider"] is None and other["pay_account_no"] is None


def test_an_unknown_method_is_refused(auth_client):
    res = _post(auth_client, pay_method="barter")
    assert res.status_code == 400


def test_details_without_a_method_are_refused(auth_client):
    res = _post(auth_client, pay_provider="BDO", pay_account_no="123456")
    assert res.status_code == 400


def test_an_employee_can_be_left_without_a_method(auth_client):
    body = _post(auth_client).json()
    assert body["pay_method"] is None


def test_switching_the_method_drops_what_the_new_one_does_not_use(auth_client):
    e = _post(auth_client, pay_method="bank_transfer", pay_provider="BDO", pay_account_no="123456").json()
    res = auth_client.put(f"/api/employees/{e['id']}", json={"pay_method": "cash"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["pay_method"], body["pay_provider"], body["pay_account_no"]) == ("cash", None, None)


def test_switching_to_a_bank_transfer_asks_for_its_details(auth_client):
    e = _post(auth_client, pay_method="cash").json()
    res = auth_client.put(f"/api/employees/{e['id']}", json={"pay_method": "bank_transfer"})
    assert res.status_code == 400

    ok = auth_client.put(
        f"/api/employees/{e['id']}",
        json={"pay_method": "bank_transfer", "pay_provider": "Metrobank", "pay_account_no": "5550001"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["pay_provider"] == "Metrobank"


def test_editing_something_else_leaves_the_payment_details(auth_client):
    e = _post(auth_client, pay_method="e_wallet", pay_provider="Maya", pay_account_no="09175550101").json()
    res = auth_client.put(f"/api/employees/{e['id']}", json={"phone": "0918"})
    body = res.json()
    assert (body["pay_method"], body["pay_provider"], body["pay_account_no"]) == ("e_wallet", "Maya", "09175550101")
