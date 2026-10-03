"""The oldest desktop app the API still serves.

The desktop app names its version on every request (``X-Client-Version``).
Below ``DESKTOP_MIN_VERSION`` it gets 426 Upgrade Required instead of an
answer, so a release that changes the sync contract can retire the builds
that would misread it. Browsers send no such header and are never affected.
"""

from __future__ import annotations

import re

HEADER = "X-Client-Version"
_VERSION = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$")


def parse(value: str) -> tuple[int, int, int] | None:
    match = _VERSION.fullmatch(value.strip())
    if not match:
        return None
    major, minor, patch = (int(part) for part in match.groups())
    return major, minor, patch


def too_old(version: str | None, minimum: str) -> bool:
    """Whether a client naming ``version`` must update first.

    No minimum set, or no version named (a browser): never. A version that
    doesn't parse: always, once a minimum is set; a desktop build always sends
    a proper one, so anything else isn't one to trust.
    """
    floor = parse(minimum) if minimum else None
    if floor is None or version is None:
        return False
    named = parse(version)
    return named is None or named < floor
