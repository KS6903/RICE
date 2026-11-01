"""Reading what any brand of sensor sends: common names found by themselves, a mill's own
field names, nested answers, units and corrections."""

from __future__ import annotations

from decimal import Decimal

from app.services.sensors import read_path, read_payload


def test_common_names_are_found_without_setup():
    assert read_payload({"hum": "68", "temp": "27.5"}) == (Decimal("68"), Decimal("27.5"))
    assert read_payload({"RH": 70, "Temperature": 30}) == (Decimal("70"), Decimal("30"))


def test_names_are_found_in_a_nested_answer():
    assert read_payload({"device": {"status": {"humidity": 61.2, "tC": 28}}}) == (Decimal("61.2"), Decimal("28"))


def test_a_mills_own_field_names_win():
    payload = {"humidity": 1, "ch": [{"v": "55%"}, {"v": "29 C"}]}
    assert read_payload(payload, humidity_field="ch.0.v", temp_field="ch.1.v") == (Decimal("55"), Decimal("29"))


def test_fahrenheit_and_corrections():
    assert read_payload({"humidity": 60, "temperature": 86}, temp_unit="f", temp_offset=Decimal("-1")) == (
        Decimal("60"),
        Decimal("29.0"),
    )
    assert read_payload({"humidity": 60}, humidity_offset=Decimal("2.5"))[0] == Decimal("62.5")


def test_what_no_gauge_could_read_counts_as_not_sent():
    assert read_payload({"humidity": 140, "temperature": 400}) == (None, None)
    assert read_payload({"humidity": "offline", "temperature": True}) == (None, None)
    assert read_payload({"battery": 90}) == (None, None)


def test_read_path_leaves_a_wrong_path_empty():
    assert read_path({"a": [1]}, "a.5") is None
    assert read_path({"a": 1}, "a.b") is None
