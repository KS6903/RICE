"""Document numbers that carry the rice mill's own short code.

``Rice Mill 1`` is ``RM1``, so its orders run RM1-0001, RM1-0002 and its trips
RM1-T0001, RM1-T0002: short, and a glance says whose paper it is. A number is
one more than the highest already used with that code, so it is never handed
out twice, even after something is deleted.
"""

from __future__ import annotations

import re

_SKIP = {"and", "of", "the", "inc", "corp", "co", "ltd", "&"}
MAX_CODE = 5
FALLBACK = "MILL"


def mill_code(name: str | None) -> str:
    """A short upper-case code from a mill's name: the initials of its words with
    any number kept whole ("Rice Mill 1" is RM1, "San Isidro Rice Mill" is SIRM),
    or the first three letters of a one-word name ("Oraiza" is ORA)."""
    tokens = re.findall(r"[A-Za-z]+|\d+", name or "")
    words = [t for t in tokens if t.isalpha() and t.lower() not in _SKIP]
    numbers = [t for t in tokens if t.isdigit()]
    if not words and not numbers:
        return FALLBACK
    if len(words) == 1 and not numbers:
        code = words[0][:3]
    else:
        code = "".join(w[0] for w in words) + "".join(numbers)
    return (code.upper() or FALLBACK)[:MAX_CODE]


def order_pattern(code: str) -> str:
    """Postgres regex for this mill's own order numbers."""
    return rf"^{re.escape(code)}-[0-9]{{1,9}}$"


def trip_pattern(code: str) -> str:
    return rf"^{re.escape(code)}-T[0-9]{{1,9}}$"


# An employee's number leads with the kind of employment: REG-0001, MON-0001,
# CON-0001. Each prefix counts on its own, per mill.
EMPLOYEE_PREFIXES = {
    "regular": "REG",
    "monthly": "MON",
    "daily": "DLY",
    "casual": "CAS",
    "biweekly": "BWK",
    "weekly": "WKL",
    "piece_rate": "PRC",
    "commission": "COM",
    "hourly": "HRL",
    "probationary": "PRB",
    "contractual": "CON",
}
EMPLOYEE_FALLBACK_PREFIX = "EMP"


def employee_prefix(employment_type: str | None) -> str:
    """The number prefix for an employment type; EMP when it is blank or unknown."""
    return EMPLOYEE_PREFIXES.get((employment_type or "").strip().lower(), EMPLOYEE_FALLBACK_PREFIX)


def employee_pattern(prefix: str) -> str:
    return rf"^{re.escape(prefix)}-[0-9]{{1,9}}$"
