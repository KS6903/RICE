"""Emails sent as a side effect of an action: an account locked, a data export,
an upgrade request filed or decided.

Best effort, every one: a mail failure is logged and never fails the action
that caused it. A locked account must still answer "locked", and an approved
upgrade must still be approved, whether or not the email went out.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.email import send_account_email
from ..core.ratelimit import LockoutState
from ..models.upgrade_request import UpgradeRequest
from ..models.user import User

logger = logging.getLogger("ricemill.platform_emails")


def _send(to: str | None, subject: str, text: str) -> bool:
    if not to:
        return False
    try:
        send_account_email(to=to, subject=subject, text=text)
        return True
    except Exception:
        logger.exception("platform email failed", extra={"subject": subject})
        return False


def _app_link(path: str) -> str:
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}{path}"


def account_locked(user: User, state: LockoutState) -> bool:
    """Tell the account holder their sign-in is locked: either it was them, and
    they know how long to wait, or it wasn't, and someone is guessing."""
    if state.permanent:
        wait = "It stays locked until the password is reset."
        action = f"Reset your password here: {_app_link('/forgot-password')}"
    else:
        minutes = max(1, round(state.retry_after / 60))
        wait = f"You can try again in about {minutes} minute{'s' if minutes != 1 else ''}."
        action = f"If you've forgotten your password, reset it here: {_app_link('/forgot-password')}"
    text = (
        f"Hello {user.full_name or user.username},\n\n"
        f"Sign-in to your {settings.APP_NAME} account ({user.username}) was locked after too many wrong "
        f"passwords. {wait}\n\n"
        f"{action}\n\n"
        "If this wasn't you, someone may be trying to guess your password. Choose a new, strong one, and "
        "tell your mill's owner.\n"
    )
    return _send(user.email, f"Your {settings.APP_NAME} sign-in was locked", text)


def data_exported(user: User, *, company: str, files: int, rows: int) -> bool:
    """Tell the owner their mill's data was downloaded: either it was them, and
    this is a receipt, or it wasn't, and they need to know today."""
    text = (
        f"Hello {user.full_name or user.username},\n\n"
        f"A full copy of {company}'s data ({rows:,} records in {files} files) was just downloaded from "
        f"{settings.APP_NAME} by your account ({user.username}).\n\n"
        "If that was you, there's nothing to do. Keep the file somewhere only the people who need it can "
        "open: it includes employees' government ID numbers.\n\n"
        "If it wasn't you, change your password now and sign out your other devices: "
        f"{_app_link('/settings')}\n"
    )
    return _send(user.email, f"{company}'s data was downloaded", text)


def redis_budget(db: Session, *, used: int, limit: int, level: int) -> int:
    """Warn platform admins that Redis is through ``level``% of the month's quota."""
    admins = db.query(User).filter(User.is_platform_admin.is_(True), User.is_active.is_(True)).all()
    text = (
        f"Upstash Redis has used {used:,} of its {limit:,} requests this month ({used / limit:.0%}).\n\n"
        "Past the quota, rate limiting, lockouts and caching fall back to each container's memory, which "
        "is weaker protection. Check the Upstash console, and either raise the plan or find what's "
        "polling.\n"
    )
    return sum(_send(a.email, f"Redis at {level}% of this month's quota", text) for a in admins)


def health_problem(db: Session, *, problem: str, detail: str) -> int:
    """Tell platform admins something in production needs a person."""
    admins = db.query(User).filter(User.is_platform_admin.is_(True), User.is_active.is_(True)).all()
    text = f"{detail}\n\nReadiness: {_app_link('/api/health/ready')}\n"
    return sum(_send(a.email, f"{settings.APP_NAME}: {problem}", text) for a in admins)


def upgrade_request_filed(db: Session, request: UpgradeRequest, *, company: str, plan: str) -> int:
    """Tell every platform admin a mill is waiting for a plan decision."""
    admins = db.query(User).filter(User.is_platform_admin.is_(True), User.is_active.is_(True)).all()
    requester = db.get(User, request.requested_by) if request.requested_by else None
    who = (requester.full_name or requester.username) if requester else "someone"
    note = f"\nTheir note: {request.note}\n" if request.note else ""
    text = (
        f"{company} asked to {'change to' if request.request_type == 'change' else 'upgrade to'} the {plan} plan "
        f"({request.billing_interval}), requested by {who}.\n{note}\n"
        f"Approve or reject it in the admin console: {_app_link('/admin/upgrade-requests')}\n"
    )
    return sum(_send(a.email, f"Upgrade request: {company} wants {plan}", text) for a in admins)


def upgrade_request_decided(db: Session, request: UpgradeRequest, *, plan: str, approved: bool, queued: bool) -> bool:
    """Tell whoever asked what was decided."""
    requester = db.get(User, request.requested_by) if request.requested_by else None
    if requester is None:
        return False
    if approved and queued:
        outcome = f"approved. The {plan} plan starts when your current plan ends."
    elif approved:
        outcome = f"approved. Your mill is on the {plan} plan now."
    else:
        outcome = "not approved."
    note = f"\nA note from us: {request.admin_note}\n" if request.admin_note else ""
    text = (
        f"Hello {requester.full_name or requester.username},\n\n"
        f"Your request for the {plan} plan was {outcome}\n{note}\n"
        f"See your plan in Settings: {_app_link('/settings')}\n"
    )
    subject = f"Your {plan} plan request was {'approved' if approved else 'not approved'}"
    return _send(requester.email, subject, text)
