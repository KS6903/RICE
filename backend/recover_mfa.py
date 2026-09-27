"""Operator-only MFA recovery with confirmation, auditing, and session revocation.

Run this from a trusted backend host with the normal application environment.
It never accepts or prints passwords, tokens, MFA seeds, or recovery codes.
"""

from __future__ import annotations

import argparse
import logging

from app.core.database import SessionLocal
from app.core.tenancy import schema_name_for, set_search_path
from app.models.auth_session import AuthSession
from app.models.base import now_utc
from app.models.user import User
from app.services.activity import log_activity

logger = logging.getLogger("ricemill.security.audit")


def _safe_label(value: str) -> str:
    return value.replace("\r", " ").replace("\n", " ").strip()[:100]


def main() -> int:
    parser = argparse.ArgumentParser(description="Disable MFA for a verified recovery case")
    parser.add_argument("username", help="Exact username to recover")
    parser.add_argument("--operator", required=True, help="Operator identity for the audit trail")
    parser.add_argument("--ticket", required=True, help="Approved recovery ticket/reference")
    args = parser.parse_args()
    operator = _safe_label(args.operator)
    ticket = _safe_label(args.ticket)
    if not operator or not ticket:
        print("Operator and ticket are required.")
        return 2

    with SessionLocal() as db:
        user = db.query(User).filter(User.username == args.username).with_for_update().first()
        if user is None:
            print("Account not found.")
            return 1
        print(f"Account: {user.username} ({user.email or 'no email'})")
        print(f"MFA currently enabled: {'yes' if user.mfa_enabled else 'no'}")
        expected = f"RESET {user.username}"
        confirmation = input(f"Type {expected!r} after completing identity verification: ")
        if confirmation != expected:
            db.rollback()
            print("Cancelled; nothing changed.")
            return 2

        user.mfa_enabled = False
        user.mfa_secret = None
        user.mfa_last_used_step = None
        user.mfa_backup_codes = None
        db.query(AuthSession).filter(
            AuthSession.user_id == user.id,
            AuthSession.revoked_at.is_(None),
        ).update({AuthSession.revoked_at: now_utc()})
        if user.company_id and user.company is not None:
            set_search_path(db, schema_name_for(user.company))
            log_activity(
                db,
                company_id=user.company_id,
                user_id=user.id,
                action="auth.mfa_recovered",
                entity_type="user",
                entity_id=user.id,
                entity_label=user.username,
                detail=(
                    "Operator-assisted recovery; MFA cleared and all sessions revoked; "
                    f"operator={operator}; ticket={ticket}."
                ),
            )
        logger.warning(
            "operator MFA recovery user=%s operator=%s ticket=%s",
            user.username,
            operator,
            ticket,
        )
        db.commit()
        print("MFA cleared and all sessions revoked. Require immediate re-enrollment.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
