"""seed_demo.py: who gets seeded, with what, in what order, and never a
database on another machine by accident."""

from __future__ import annotations

import pytest

import seed_demo


@pytest.fixture
def ran(monkeypatch):
    calls: list[tuple[str, str, bool]] = []
    monkeypatch.setattr(seed_demo, "database_host", lambda: "localhost")
    fakes = {
        name: (lambda name: lambda user, reset: calls.append((name, user, reset)) or f"{user}: ok")(name)
        for name in seed_demo.PARTS
    }
    monkeypatch.setattr(seed_demo, "PARTS", fakes)
    return calls


def test_tier_1_by_default_every_part_in_order(ran):
    assert seed_demo.main([]) == 0
    assert [(part, user) for part, user, _ in ran][:3] == [("base", "mill1"), ("base", "mill2"), ("base", "mill3")]
    assert [part for part, _, _ in ran] == [p for p in seed_demo.PARTS for _ in range(3)]


def test_all_is_mill1_to_mill8(ran):
    seed_demo.main(["--all", "--only", "sales"])
    assert [user for _, user, _ in ran] == [f"mill{i}" for i in range(1, 9)]


def test_only_runs_in_dependency_order_whatever_order_it_was_given(ran):
    seed_demo.main(["mill4", "--only", "sales,base", "--reset"])
    assert ran == [("base", "mill4", True), ("sales", "mill4", True)]


@pytest.mark.parametrize("argv", [["--only", "nope"], ["mill1", "--all"]])
def test_bad_arguments_are_refused(ran, argv):
    with pytest.raises(SystemExit):
        seed_demo.main(argv)
    assert ran == []


def test_a_database_elsewhere_is_refused(ran, monkeypatch, capsys):
    monkeypatch.setattr(seed_demo, "database_host", lambda: "db.prod.example.com")
    with pytest.raises(SystemExit):
        seed_demo.main([])
    assert "db.prod.example.com" in capsys.readouterr().err
    assert ran == []
    assert seed_demo.main(["--allow-remote", "--only", "base", "mill1"]) == 0


def test_the_enterprise_demo_is_mill1s_alone():
    assert seed_demo._automations("mill2", False) == "mill2: Enterprise demo, mill1 only — skipped"
