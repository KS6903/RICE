"""The Boss closing the mill's account, and opening it again (core/account_status.py).

Closing waits until nothing is left open with Oraiza: no unpaid fees, no plan
request still being reviewed, and no paid time left on the plan. The Boss
confirms with their password (and authenticator code when two-factor is on),
and, to ask for deletion, types the mill's name. Everyone is signed out.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

from ..core import account_status
from ..core.exceptions import ConflictError, ValidationError
from ..models.auth_session import AuthSession
from ..models.base import now_utc
from ..models.company import Company
from ..models.subscription import Subscription
from ..models.upgrade_request import UpgradeRequest
from ..models.user import User
from .activity import log_activity
from .auth_service import AuthService
from .base import BaseService


def _day(when: datetime) -> str:
    return f"{when:%d %B %Y}"


def dealings_with_oraiza(db: Session, company: Company, *, now: datetime) -> list[dict]:
    """What the mill still has open with Oraiza, each as {code, message}."""
    found: list[dict] = []
    pending = (
        db.query(UpgradeRequest)
        .options(joinedload(UpgradeRequest.requested_plan))
        .filter(UpgradeRequest.company_id == company.id, UpgradeRequest.status == "pending")
        .first()
    )
    if pending is not None:
        plan = pending.requested_plan.name if pending.requested_plan else "a new"
        found.append(
            {
                "code": "plan_request",
                "message": f"Your request for the {plan} plan is still being reviewed. "
                "Cancel it in Billing, or wait for Oraiza's answer.",
            }
        )
    sub = (
        db.query(Subscription)
        .options(joinedload(Subscription.plan))
        .filter(Subscription.company_id == company.id)
        .first()
    )
    if sub is None or sub.plan is None:
        return found
    name = sub.plan.name
    if sub.status == "past_due":
        found.append(
            {"code": "unpaid", "message": f"Your {name} plan has fees still unpaid. Settle them with Oraiza first."}
        )
    paid = (sub.plan.monthly_price or Decimal(0)) > 0 or (sub.plan.annual_price or Decimal(0)) > 0
    if paid and sub.status == "active":
        if sub.expires_at is None:
            found.append(
                {
                    "code": "paid_time",
                    "message": f"Your {name} plan is still running. Ask Oraiza to end it before you close the account.",
                }
            )
        elif sub.expires_at > now:
            found.append(
                {
                    "code": "paid_time",
                    "message": f"Your {name} plan is paid until {_day(sub.expires_at)}. "
                    "You can close the account once it ends.",
                }
            )
    return found


class AccountService(BaseService):
    def __init__(self, db: Session, current_user: Any) -> None:
        super().__init__(db, current_user)

    @property
    def company(self) -> Company:
        return self.current_user.company

    def closure(self) -> dict:
        """The account's state, and what stops it being closed now."""
        return {
            **account_status.describe_account(self.company),
            "company_name": self.company.name,
            "export_window_days": account_status.export_window_days(),
            "blockers": dealings_with_oraiza(self.db, self.company, now=now_utc()),
        }

    def close(self, data) -> dict:
        company = self.company
        if account_status.state(company) != account_status.OPEN:
            raise ConflictError("This account is already closed.", code="account_closed")
        now = now_utc()
        blockers = dealings_with_oraiza(self.db, company, now=now)
        if blockers:
            raise ConflictError(" ".join(b["message"] for b in blockers), code="account_has_dealings")
        delete = data.mode == "delete"
        if delete and (data.confirm_name or "").strip().lower() != company.name.strip().lower():
            raise ValidationError(f"Type the mill's name, {company.name}, to confirm.")
        reason = "Ask to delete the account" if delete else "Pause the account"
        AuthService(self.db, self.current_user).confirm_identity(data.current_password, data.mfa_code, reason=reason)
        with self.transaction():
            company.is_active = False
            company.closed_at = now
            company.closed_by = self.current_user.id
            company.deletion_requested_at = now if delete else None
            # Everyone is signed out, the Boss too: their next sign-in lands on
            # the closed-account screen.
            self.db.execute(
                update(AuthSession)
                .where(
                    AuthSession.user_id.in_(select(User.id).where(User.company_id == company.id)),
                    AuthSession.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
            log_activity(
                self.db,
                company_id=company.id,
                user_id=self.current_user.id,
                action="account.deletion_requested" if delete else "account.paused",
                entity_type="company",
                entity_id=company.id,
                entity_label=company.name,
            )
        return account_status.describe_account(company)

    def reopen(self) -> dict:
        """Switch a paused account back on, or take back a deletion request."""
        company = self.company
        if not account_status.boss_may_enter(self.current_user, now=now_utc()):
            raise ConflictError("This account can't be reopened.", code="account_not_reopenable")
        was = account_status.state(company)
        with self.transaction():
            company.is_active = True
            company.closed_at = None
            company.closed_by = None
            company.deletion_requested_at = None
            log_activity(
                self.db,
                company_id=company.id,
                user_id=self.current_user.id,
                action="account.deletion_cancelled" if was == account_status.DELETION_REQUESTED else "account.reopened",
                entity_type="company",
                entity_id=company.id,
                entity_label=company.name,
            )
        return account_status.describe_account(company)
