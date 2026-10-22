"""Characterization: the dispatch domain (Phase 3 target).

Agents/millers CRUD with system-assigned canva colors, the palette helper, the
dispatch order list, and the courier-assignment / mark-delivered flow.
"""

AGENT_KEYS = {
    "id",
    "name",
    "agent_type",
    "contact_person",
    "phone",
    "address",
    "commission_pct",
    "is_active",
    "canva_color_hex",
    "deactivated_at",
    "deactivated_by",
}
MILLER_KEYS = {
    "id",
    "name",
    "contact_person",
    "phone",
    "address",
    "capacity_kg_per_hr",
    "milling_fee_per_kg",
    "is_active",
    "canva_color_hex",
    "deactivated_at",
    "deactivated_by",
}
ORDER_KEYS = {
    "id",
    "order_no",
    "order_date",
    "delivery_date",
    "status",
    "total_amount",
    "delivered_at",
    "unmark_until",
    "customer",
    "courier_type",
    "courier_plate",
    "courier_driver",
    "courier_phone",
    "courier_notes",
    "assigned_agent",
    "assigned_miller",
}


def test_create_agent_serialized(auth_client):
    res = auth_client.post("/api/agents", json={"name": "Agent A"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert set(body.keys()) == AGENT_KEYS
    assert body["canva_color_hex"]
    assert body["commission_pct"] == 0.0
    assert body["is_active"] is True


def test_agent_crud_and_soft_delete(auth_client):
    a = auth_client.post("/api/agents", json={"name": "Agent B"}).json()
    assert any(x["id"] == a["id"] for x in auth_client.get("/api/agents").json())

    upd = auth_client.put(f"/api/agents/{a['id']}", json={"name": "Agent B2"})
    assert upd.status_code == 200 and upd.json()["name"] == "Agent B2"

    res = auth_client.delete(f"/api/agents/{a['id']}")
    assert res.status_code == 200 and res.json() == {"ok": True}
    # Soft-deleted: gone from the default (active-only) list.
    assert all(x["id"] != a["id"] for x in auth_client.get("/api/agents").json())


def test_agent_type_can_be_cleared(auth_client):
    a = auth_client.post("/api/agents", json={"name": "Agent C", "agent_type": "broker"}).json()
    assert a["agent_type"] == "broker"

    # Leaving the type out of an update keeps it...
    kept = auth_client.put(f"/api/agents/{a['id']}", json={"name": "Agent C2"})
    assert kept.json()["agent_type"] == "broker"

    # ...and sending it as null clears it.
    cleared = auth_client.put(f"/api/agents/{a['id']}", json={"agent_type": None})
    assert cleared.status_code == 200 and cleared.json()["agent_type"] is None


def test_create_miller_serialized(auth_client):
    res = auth_client.post("/api/millers", json={"name": "Miller M"})
    assert res.status_code == 201, res.text
    assert set(res.json().keys()) == MILLER_KEYS
    assert res.json()["canva_color_hex"]


def test_palette_shape(auth_client):
    res = auth_client.get("/api/dispatch/palette")
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"palette", "in_use"}
    assert isinstance(body["palette"], list)


def test_dispatch_orders_courier_and_delivery(auth_client):
    customer = auth_client.post("/api/sales/customers", json={"name": "Disp Co"}).json()
    order = auth_client.post(
        "/api/sales/orders",
        json={
            "customer_id": customer["id"],
            "order_date": "2026-06-05",
            "items": [{"item_type": "milled_rice", "quantity_kg": "10", "unit_price_per_kg": "40"}],
        },
    ).json()

    orders = auth_client.get("/api/dispatch/orders").json()
    mine = next(o for o in orders if o["id"] == order["id"])
    assert set(mine.keys()) == ORDER_KEYS

    assigned = auth_client.patch(
        f"/api/sales-orders/{order['id']}/assign-courier",
        json={
            "courier_type": "mill",
            "plate_number": " abc  1234 ",
            "driver_name": "Juan  Dela Cruz",
            "driver_phone": "0917 123 4567",
            "notes": "Truck leaves at 6am",
        },
    )
    assert assigned.status_code == 200
    assert assigned.json()["courier_type"] == "mill"
    assert assigned.json()["courier_plate"] == "ABC 1234"
    assert assigned.json()["courier_driver"] == "Juan Dela Cruz"
    assert assigned.json()["courier_phone"] == "0917 123 4567"
    assert assigned.json()["courier_notes"] == "Truck leaves at 6am"
    assert assigned.json()["assigned_agent"] is None
    assert assigned.json()["assigned_miller"] is None

    # Either courier needs the plate number and the driver.
    for body in (
        {"courier_type": "customer"},
        {"courier_type": "customer", "plate_number": "XYZ 987"},
        {"courier_type": "mill", "plate_number": "  ", "driver_name": "Ana"},
    ):
        missing = auth_client.patch(f"/api/sales-orders/{order['id']}/assign-courier", json=body)
        assert missing.status_code == 400, body
        assert "plate number" in missing.json()["detail"]

    # The customer collecting it is the other choice; the phone and notes are optional.
    customer_pickup = auth_client.patch(f"/api/sales-orders/{order['id']}/assign-courier", json=PICKUP)
    assert customer_pickup.status_code == 200
    assert customer_pickup.json()["courier_type"] == "customer"
    assert customer_pickup.json()["courier_plate"] == "XYZ 987"
    assert customer_pickup.json()["courier_phone"] is None
    assert customer_pickup.json()["courier_notes"] is None

    # Nothing else is a courier: an agent, a miller or any other kind is refused.
    for body in (
        {"agent_id": "00000000-0000-0000-0000-000000000000"},
        {"miller_id": "00000000-0000-0000-0000-000000000000"},
        {"courier_type": "agent"},
    ):
        refused = auth_client.patch(f"/api/sales-orders/{order['id']}/assign-courier", json=body)
        assert refused.status_code == 422, body

    delivered = auth_client.patch(f"/api/sales-orders/{order['id']}/mark-delivered")
    assert delivered.status_code == 200
    assert delivered.json()["status"] == "delivered"
    assert delivered.json()["delivered_at"]


# The customer collecting it in their own vehicle; the mill's courier likewise.
PICKUP = {"courier_type": "customer", "plate_number": "XYZ 987", "driver_name": "Ana"}
MILL = {"courier_type": "mill", "plate_number": "ABC 1234", "driver_name": "Juan"}


def _confirmed_order(auth_client):
    customer = auth_client.post("/api/sales/customers", json={"name": "Courier Co"}).json()
    return auth_client.post(
        "/api/sales/orders",
        json={
            "customer_id": customer["id"],
            "order_date": "2026-06-05",
            "items": [{"item_type": "milled_rice", "quantity_kg": "10", "unit_price_per_kg": "50"}],
        },
    ).json()


def test_nothing_is_delivered_without_a_courier(auth_client):
    order = _confirmed_order(auth_client)

    # Neither the dispatch action nor a plain order update may skip the courier.
    no_courier = auth_client.patch(f"/api/sales-orders/{order['id']}/mark-delivered")
    assert no_courier.status_code == 409
    assert "courier" in no_courier.json()["detail"].lower()
    sneaky = auth_client.put(f"/api/sales/orders/{order['id']}", json={"status": "delivered"})
    assert sneaky.status_code == 409

    # The order is still confirmed and undelivered.
    still = next(o for o in auth_client.get("/api/sales/orders").json() if o["id"] == order["id"])
    assert still["status"] == "confirmed" and still["delivered_at"] is None

    # With a courier it goes through, and the courier can't then be taken off.
    auth_client.patch(f"/api/sales-orders/{order['id']}/assign-courier", json=PICKUP)
    done = auth_client.patch(f"/api/sales-orders/{order['id']}/mark-delivered")
    assert done.status_code == 200 and done.json()["status"] == "delivered"
    removed = auth_client.patch(f"/api/sales-orders/{order['id']}/assign-courier", json={})
    assert removed.status_code == 409


def test_a_courier_can_still_be_removed_before_delivery(auth_client):
    order = _confirmed_order(auth_client)
    auth_client.patch(f"/api/sales-orders/{order['id']}/assign-courier", json={**MILL, "notes": "x"})
    cleared = auth_client.patch(f"/api/sales-orders/{order['id']}/assign-courier", json={})
    assert cleared.status_code == 200
    assert cleared.json()["courier_type"] is None
    assert cleared.json()["courier_plate"] is None
    assert cleared.json()["courier_driver"] is None
    assert cleared.json()["courier_notes"] is None


def _delivered_order(auth_client):
    order = _confirmed_order(auth_client)
    auth_client.patch(f"/api/sales-orders/{order['id']}/assign-courier", json=MILL)
    done = auth_client.patch(f"/api/sales-orders/{order['id']}/mark-delivered")
    assert done.status_code == 200, done.text
    return order, done.json()


def test_owner_can_unmark_a_delivery_within_a_week(auth_client):
    order, done = _delivered_order(auth_client)
    assert done["unmark_until"]  # the page uses this to show or hide the button

    back = auth_client.patch(f"/api/sales-orders/{order['id']}/unmark-delivered")
    assert back.status_code == 200, back.text
    assert back.json()["status"] == "confirmed"
    assert back.json()["delivered_at"] is None
    assert back.json()["unmark_until"] is None

    # And it can be marked again.
    again = auth_client.patch(f"/api/sales-orders/{order['id']}/mark-delivered")
    assert again.status_code == 200 and again.json()["status"] == "delivered"


def test_a_delivery_cannot_be_unmarked_after_a_week(auth_client, db_session):
    from datetime import datetime, timedelta, timezone

    from app.models.sales import SalesOrder

    order, _ = _delivered_order(auth_client)
    row = db_session.query(SalesOrder).filter(SalesOrder.id == order["id"]).one()
    row.delivered_at = datetime.now(timezone.utc) - timedelta(days=8)
    db_session.flush()

    late = auth_client.patch(f"/api/sales-orders/{order['id']}/unmark-delivered")
    assert late.status_code == 409
    assert "7 days" in late.json()["detail"]
    # The plain order update can't get round it either.
    sneaky = auth_client.put(f"/api/sales/orders/{order['id']}", json={"status": "confirmed"})
    assert sneaky.status_code == 409


def test_only_the_owner_can_take_a_delivery_or_trip_status_back():
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace

    import pytest

    from app.core.exceptions import PermissionDeniedError
    from app.services.delivery_rules import check_can_unmark, check_can_unmark_trip

    now = datetime.now(timezone.utc)
    order = SimpleNamespace(status="delivered", delivered_at=now, updated_at=now)
    trip = SimpleNamespace(status="completed", status_changed_at=now, updated_at=now)
    owner = SimpleNamespace(role=SimpleNamespace(name="owner"), is_platform_admin=False)
    cashier = SimpleNamespace(role=SimpleNamespace(name="cashier"), is_platform_admin=False)

    check_can_unmark(order, owner)
    check_can_unmark_trip(trip, owner)
    with pytest.raises(PermissionDeniedError):
        check_can_unmark(order, cashier)
    with pytest.raises(PermissionDeniedError):
        check_can_unmark_trip(trip, cashier)
    # Even the owner is out of time after a week.
    with pytest.raises(Exception, match="7 days"):
        check_can_unmark(order, owner, now=now + timedelta(days=8))


def test_trip_numbers_carry_the_mill_code_and_the_owner_can_edit_them(auth_client):
    truck = auth_client.post("/api/fleet/trucks", json={"plate_number": "ABC 123"}).json()
    driver = auth_client.post("/api/fleet/drivers", json={"name": "Driver One"}).json()

    def trip():
        res = auth_client.post(
            "/api/fleet/trips",
            json={"truck_id": truck["id"], "driver_id": driver["id"], "dispatch_date": "2026-06-05"},
        )
        assert res.status_code == 201, res.text
        return res.json()

    first, second = trip(), trip()
    assert (first["trip_no"], second["trip_no"]) == ("TM-T0001", "TM-T0002")

    renamed = auth_client.put(f"/api/fleet/trips/{first['id']}", json={"trip_no": "TM-T0100"})
    assert renamed.status_code == 200 and renamed.json()["trip_no"] == "TM-T0100"
    # The count carries on from the highest.
    assert trip()["trip_no"] == "TM-T0101"
    # A number already used by another trip is refused.
    clash = auth_client.put(f"/api/fleet/trips/{second['id']}", json={"trip_no": "TM-T0100"})
    assert clash.status_code == 409


def test_a_departed_or_delivered_trip_is_editable_for_a_week_then_locks(auth_client, db_session):
    from datetime import datetime, timedelta, timezone

    from app.models.fleet import DispatchTrip

    truck = auth_client.post("/api/fleet/trucks", json={"plate_number": "XYZ 987"}).json()
    driver = auth_client.post("/api/fleet/drivers", json={"name": "Driver Two"}).json()
    trip = auth_client.post(
        "/api/fleet/trips",
        json={"truck_id": truck["id"], "driver_id": driver["id"], "dispatch_date": "2026-06-05"},
    ).json()
    url = f"/api/fleet/trips/{trip['id']}"
    assert trip["edit_until"] is None  # a planned trip is open to edits

    departed = auth_client.put(url, json={"status": "in_transit"}).json()
    assert departed["status_changed_at"] and departed["edit_until"]
    # Still editable while departed...
    assert auth_client.put(url, json={"notes": "left at 6am"}).status_code == 200
    # ...and going on to delivered is a normal step.
    assert auth_client.put(url, json={"status": "completed"}).json()["status"] == "completed"
    assert auth_client.put(url, json={"fuel_used_l": "42"}).status_code == 200

    # The owner can take the delivered mark back within the week.
    back = auth_client.put(url, json={"status": "in_transit"})
    assert back.status_code == 200 and back.json()["status"] == "in_transit"

    # After a week from the last status change, nothing can be edited.
    row = db_session.query(DispatchTrip).filter(DispatchTrip.id == trip["id"]).one()
    row.status_changed_at = datetime.now(timezone.utc) - timedelta(days=8)
    db_session.flush()
    for body in ({"notes": "too late"}, {"status": "completed"}, {"trip_no": "TM-T0999"}):
        late = auth_client.put(url, json=body)
        assert late.status_code == 409, body
        assert "7 days" in late.json()["detail"]


def test_a_tenant_schema_refuses_a_duplicate_party_colour(db_session, seed_owner):
    """The per-table colour indexes come from the models now, so a newly
    provisioned tenant has them; before, only a one-off script ever made them."""
    import pytest
    from sqlalchemy.exc import IntegrityError

    from app.models.supplier_customer import Customer

    db_session.add(Customer(company_id=seed_owner.company_id, name="A", canva_color_hex="#10b981"))
    db_session.flush()
    db_session.add(Customer(company_id=seed_owner.company_id, name="B", canva_color_hex="#10b981"))
    with pytest.raises(IntegrityError, match="uq_customers_company_color"):
        db_session.flush()
    db_session.rollback()
