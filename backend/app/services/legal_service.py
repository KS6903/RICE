"""LegalService — publishes the agreements and records who accepted what.

The read side is a thin wrapper over core.legal (no database). The write side
appends to the acceptance ledger; nothing here ever updates or deletes a row,
because the value of the ledger is that it is append-only.
"""
from __future__ import annotations

import uuid

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core import legal
from ..core.ratelimit import client_ip
from ..models.legal import LegalAcceptance

# A user agent is evidence of circumstance, not a fingerprint to keep forever.
_USER_AGENT_MAX = 400


class LegalService:
    def __init__(self, db: Session | None = None) -> None:
        self.db = db

    # ── Publishing ────────────────────────────────────────────────────────

    def index(self) -> dict:
        return {
            "agreement_version": legal.AGREEMENT_VERSION,
            "bundle_hash": legal.bundle_hash(),
            "documents": legal.index(),
        }

    def document(self, key: str) -> dict:
        doc = legal.BY_KEY[key]
        return {
            "key": doc.key,
            "title": doc.title,
            "version": doc.version,
            "effective_date": doc.effective_date.isoformat(),
            "summary": doc.summary,
            "in_bundle": doc.in_bundle,
            "sha256": legal.content_hash(key),
            "markdown": legal.render(key),
        }

    # ── Acceptance ────────────────────────────────────────────────────────

    def record_acceptance(
        self,
        *,
        user_id: uuid.UUID,
        company_id: uuid.UUID | None,
        request: Request | None,
        method: str = "signup",
    ) -> LegalAcceptance:
        """Append one acceptance row. Caller owns the transaction.

        Deliberately does not commit: at signup this has to land in the same
        transaction as the user row, so that an account can never exist
        without the acceptance that created it.
        """
        assert self.db is not None, "LegalService needs a session to record acceptance"
        row = LegalAcceptance(
            user_id=user_id,
            company_id=company_id,
            agreement_version=legal.AGREEMENT_VERSION,
            content_hash=legal.bundle_hash(),
            documents=legal.bundle_manifest(),
            method=method,
            ip_address=(client_ip(request) if request else None),
            user_agent=((request.headers.get("user-agent") or "")[:_USER_AGENT_MAX] or None)
            if request
            else None,
        )
        self.db.add(row)
        return row

    def latest_acceptance(self, user_id: uuid.UUID) -> LegalAcceptance | None:
        assert self.db is not None
        stmt = (
            select(LegalAcceptance)
            .where(LegalAcceptance.user_id == user_id)
            .order_by(LegalAcceptance.accepted_at.desc())
            .limit(1)
        )
        return self.db.execute(stmt).scalars().first()

    def acceptance_required(self, user_id: uuid.UUID) -> bool:
        """True when the user has never accepted, or accepted an older bundle.

        Called on every /auth/me, so it is one indexed lookup and no document
        rendering beyond the cached in-process hash.
        """
        latest = self.latest_acceptance(user_id)
        if latest is None:
            return True
        if latest.agreement_version != legal.AGREEMENT_VERSION:
            return True
        # A version that was re-published with different text is treated as a
        # new version, so nobody is bound by text they were never shown.
        return latest.content_hash != legal.bundle_hash()

    def status(self, user_id: uuid.UUID) -> dict:
        latest = self.latest_acceptance(user_id)
        return {
            "agreement_version": legal.AGREEMENT_VERSION,
            "acceptance_required": self.acceptance_required(user_id),
            "accepted_version": latest.agreement_version if latest else None,
            "accepted_at": latest.accepted_at.isoformat() if latest else None,
            "documents": [
                {
                    "key": k,
                    "title": legal.BY_KEY[k].title,
                    "version": legal.BY_KEY[k].version,
                    "effective_date": legal.BY_KEY[k].effective_date.isoformat(),
                }
                for k in legal.BUNDLE_KEYS
            ],
        }

    def history(self, user_id: uuid.UUID, limit: int = 50) -> list[dict]:
        assert self.db is not None
        stmt = (
            select(LegalAcceptance)
            .where(LegalAcceptance.user_id == user_id)
            .order_by(LegalAcceptance.accepted_at.desc())
            .limit(limit)
        )
        rows = self.db.execute(stmt).scalars().all()
        return [
            {
                "agreement_version": r.agreement_version,
                "content_hash": r.content_hash,
                "documents": r.documents,
                "method": r.method,
                "accepted_at": r.accepted_at.isoformat(),
            }
            for r in rows
        ]
