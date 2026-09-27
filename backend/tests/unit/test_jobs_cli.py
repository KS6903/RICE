"""The jobs entrypoint validates its arguments before touching the database."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "app.jobs", *args], cwd=BACKEND, capture_output=True, text=True, timeout=60
    )


def test_now_must_be_an_iso_timestamp():
    result = _run("--now", "tomorrow")
    assert result.returncode == 2 and "not an ISO timestamp" in result.stderr


def test_now_must_carry_an_offset():
    result = _run("--now", "2026-09-27T03:05")
    assert result.returncode == 2 and "needs a UTC offset" in result.stderr
