"""Whether a mill's account is open, paused by its Boss, or waiting to be deleted.

The Boss can close the account from Settings > My Profile (Terms of Service
17.2), in one of two ways:

- **pause** it: nothing is deleted, and the Boss can switch it back on whenever
  they like;
- **ask for it to be deleted**: for the export window (entity.json's
  ``data_export_window_days``, Terms 17.4) the Boss can still download the
  mill's data or change their mind. After that the request waits for Oraiza,
  who deletes the mill within ``data_deletion_days``. Nothing here deletes
  anything.

Either way ``companies.is_active`` goes false, so staff can't sign in, and
``closed_at`` says it was the Boss, not Oraiza (Oraiza's own switch in the
admin console leaves it empty). While they may come back, the Boss can sign in,
to a screen that only reopens the account or downloads its data
(security.enforce_account_open keeps everything else shut).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from . import legal

OPEN = "open"
PAUSED = "paused"
DELETION_REQUESTED = "deletion_requested"
# Switched off by Oraiza from the admin console.
DEACTIVATED = "deactivated"

DEACTIVATED_MESSAGE = "Your company account has been deactivated. Please contact the platform administrator."


def export_window_days() -> int:
    """How long after asking for deletion the Boss may still come back."""
    try:
        return int(legal.entity().get("data_export_window_days", "30"))
    except ValueError:
        return 30


def state(company: Any) -> str:
    if company is None or company.is_active:
        return OPEN
    if company.closed_at is None:
        return DEACTIVATED
    return DELETION_REQUESTED if company.deletion_requested_at is not None else PAUSED


def export_until(company: Any) -> datetime | None:
    """The end of a deletion request's export window, or None."""
    if company is None or company.deletion_requested_at is None:
        return None
    return company.deletion_requested_at + timedelta(days=export_window_days())


def _is_boss(user: Any) -> bool:
    role = getattr(user, "role", None)
    return bool(role and role.name == "owner")


def boss_may_enter(user: Any, *, now: datetime) -> bool:
    """The Boss of a mill they closed themselves, while they may still come back."""
    company = getattr(user, "company", None)
    if company is None or company.is_active or company.closed_at is None or not _is_boss(user):
        return False
    until = export_until(company)
    return until is None or now < until


def sign_in_refusal(user: Any, *, now: datetime) -> str | None:
    """Why this user can't sign in because of their mill's account, or None."""
    company = getattr(user, "company", None)
    if company is None or company.is_active or boss_may_enter(user, now=now):
        return None
    current = state(company)
    if current == PAUSED:
        return "This mill's account is paused by its Boss. Ask them to switch it back on."
    if current == DELETION_REQUESTED:
        if _is_boss(user):
            asked = company.deletion_requested_at
            return (
                f"This account is being deleted, as you asked on {asked:%d %B %Y}. "
                "Write to Oraiza if you have any questions."
            )
        return "This mill's account is being deleted, as its Boss asked."
    return DEACTIVATED_MESSAGE


def describe_account(company: Any) -> dict:
    """What /auth/me and the admin console show about the account."""
    until = export_until(company)
    return {
        "state": state(company),
        "closed_at": company.closed_at.isoformat() if company is not None and company.closed_at else None,
        "deletion_requested_at": (
            company.deletion_requested_at.isoformat() if company is not None and company.deletion_requested_at else None
        ),
        "export_until": until.isoformat() if until else None,
    }
