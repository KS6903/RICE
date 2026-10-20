"""Logging must actually emit the app's INFO lines, as JSON in production."""

from __future__ import annotations

import io
import json
import logging

import pytest

from app.core.logging_config import JsonFormatter, configure_logging


@pytest.fixture
def restore_root_logger():
    root = logging.getLogger()
    handlers, level = list(root.handlers), root.level
    yield root
    root.handlers[:] = handlers
    root.setLevel(level)


def _record(msg: str, **extra) -> logging.LogRecord:
    record = logging.LogRecord("ricemill.test", logging.INFO, __file__, 1, msg, None, None)
    for key, value in extra.items():
        setattr(record, key, value)
    return record


def test_json_lines_carry_level_logger_message_and_extras():
    line = JsonFormatter().format(_record("job succeeded", job="x.y", seconds=0.5))
    payload = json.loads(line)
    assert payload["level"] == "INFO"
    assert payload["logger"] == "ricemill.test"
    assert payload["msg"] == "job succeeded"
    assert (payload["job"], payload["seconds"]) == ("x.y", 0.5)
    assert payload["ts"].endswith("+00:00")


def test_exceptions_are_included():
    try:
        raise ValueError("bad")
    except ValueError:
        import sys

        record = logging.LogRecord("t", logging.ERROR, __file__, 1, "failed", None, sys.exc_info())
    assert "ValueError: bad" in json.loads(JsonFormatter().format(record))["exc"]


def test_configure_logging_passes_info_lines_and_is_idempotent(restore_root_logger):
    configure_logging(json_output=True)
    configure_logging(json_output=True)
    ours = [h for h in restore_root_logger.handlers if h.get_name() == "oraiza"]
    assert len(ours) == 1 and isinstance(ours[0].formatter, JsonFormatter)

    stream = io.StringIO()
    ours[0].setStream(stream)
    # The audit trail logs at INFO; before this module existed it went nowhere.
    logging.getLogger("ricemill.security.audit").info("mutation", extra={"request_id": "r1"})
    assert json.loads(stream.getvalue())["request_id"] == "r1"


def test_development_output_is_readable_text(restore_root_logger):
    configure_logging(json_output=False)
    [ours] = [h for h in restore_root_logger.handlers if h.get_name() == "oraiza"]
    assert not isinstance(ours.formatter, JsonFormatter)
