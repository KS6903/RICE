"""Process-wide logging setup for the API and the jobs runner.

Until this existed nothing configured the root logger, so it stayed at
WARNING: every INFO line the app writes, including the security audit trail
(``ricemill.security.audit``) and provisioning outcomes, was silently dropped.

Production writes one JSON object per line to stderr, where the container
platform collects it and fields stay searchable. Development gets readable
text. Tests configure nothing and leave logging to pytest.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

# Attributes every LogRecord carries; anything else on a record came from
# `extra=` and is worth keeping as a field.
_RECORD_ATTRS = frozenset(
    vars(logging.LogRecord("", logging.INFO, "", 0, "", None, None)).keys() | {"message", "asctime", "taskName"}
)
_HANDLER_NAME = "oryza"


class JsonFormatter(logging.Formatter):
    """One JSON object per record: time, level, logger, message, extras."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key, value in vars(record).items():
            if key not in _RECORD_ATTRS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(*, json_output: bool, level: int = logging.INFO) -> None:
    """Send the root logger to stderr at ``level``. Safe to call more than once."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        if handler.get_name() == _HANDLER_NAME:
            root.removeHandler(handler)
    handler = logging.StreamHandler(sys.stderr)
    handler.set_name(_HANDLER_NAME)
    handler.setFormatter(
        JsonFormatter() if json_output else logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    root.addHandler(handler)
    root.setLevel(level)
