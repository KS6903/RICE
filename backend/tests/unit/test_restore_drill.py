"""The restore drill's guards: it drops its target, so it must refuse anything
that isn't a scratch database, and it must keep passwords off command lines."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "restore_drill", Path(__file__).resolve().parents[2] / "scripts" / "restore_drill.py"
)
assert _SPEC and _SPEC.loader
restore_drill = importlib.util.module_from_spec(_SPEC)
sys.modules["restore_drill"] = restore_drill  # its dataclasses look themselves up there
_SPEC.loader.exec_module(restore_drill)

SOURCE = "postgresql+psycopg://reader:s3cret@db.example.org:5432/oryza?sslmode=require"


def _main(monkeypatch, source: str, target: str) -> None:
    monkeypatch.setenv("BACKUP_SOURCE_DATABASE_URL", source)
    monkeypatch.setenv("RESTORE_DRILL_TARGET_URL", target)
    monkeypatch.setattr("sys.argv", ["restore_drill.py"])
    restore_drill.main()


def test_a_target_not_named_for_the_drill_is_refused(monkeypatch, capsys):
    with pytest.raises(SystemExit):
        _main(monkeypatch, SOURCE, "postgresql://u:p@localhost/oryza")
    assert "must contain 'restore_drill'" in capsys.readouterr().err


def test_the_source_is_never_the_target(monkeypatch, capsys):
    same = "postgresql://u:p@localhost/restore_drill"
    with pytest.raises(SystemExit):
        _main(monkeypatch, same, same)
    assert "the target is the source" in capsys.readouterr().err


def test_without_urls_it_says_what_to_set(monkeypatch, capsys):
    monkeypatch.delenv("BACKUP_SOURCE_DATABASE_URL", raising=False)
    monkeypatch.delenv("RESTORE_DRILL_TARGET_URL", raising=False)
    monkeypatch.setattr("sys.argv", ["restore_drill.py"])
    with pytest.raises(SystemExit):
        restore_drill.main()
    assert "set the source and target" in capsys.readouterr().err


def test_the_password_goes_in_the_environment_not_the_command_line():
    url, env = restore_drill._libpq(restore_drill._plain(SOURCE))
    assert "s3cret" not in url
    assert url == "postgresql://reader@db.example.org:5432/oryza?sslmode=require"
    assert env["PGPASSWORD"] == "s3cret"


def test_urls_libpq_would_reject_are_encoded():
    # SQLAlchemy accepts a database name with spaces; libpq doesn't.
    assert restore_drill._plain("postgresql://u:p@localhost:5432/Rice Mill System?application_name=a b") == (
        "postgresql://u:p@localhost:5432/Rice%20Mill%20System?application_name=a%20b"
    )
