"""Notices for users: the bell in the web app, and email when asked for.

notify() records one notice per recipient and never repeats one: (user_id,
dedupe_key) is unique, so a retried job is harmless. Email is not sent inside
notify(). deliver_pending_emails() sends it after the producing work has
committed, so a rolled-back job never emails anyone, and one SMTP connection
serves the whole batch. Every function here takes a session already on the
tenant's schema.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ..core.mailer import Mailer
from ..models.base import now_utc
from ..models.notification import Notification
from ..models.user import User

logger = logging.getLogger("ricemill.notifications")

# Most emails one tenant can send in 24 hours: a runaway producer must not burn
# the sending domain's reputation. Anything over it stays pending until later.
DAILY_EMAIL_CAP = 200


def notify(
    db: Session,
    *,
    company_id: uuid.UUID,
    user_ids: Iterable[uuid.UUID],
    kind: str,
    title: str,
    dedupe_key: str,
    body: str | None = None,
    link: str | None = None,
    email: bool = False,
) -> int:
    """Record a notice for each user; returns how many were new. Does not commit."""
    rows = [
        {
            "id": uuid.uuid4(),
            "company_id": company_id,
            "user_id": user_id,
            "kind": kind,
            "title": title[:160],
            "body": body,
            "link": link,
            "dedupe_key": dedupe_key[:120],
            "email_status": "pending" if email else "none",
        }
        for user_id in dict.fromkeys(user_ids)
    ]
    if not rows:
        return 0
    stmt = (
        insert(Notification)
        .values(rows)
        .on_conflict_do_nothing(constraint="uq_notifications_user_dedupe")
        .returning(Notification.id)
    )
    return len(db.execute(stmt).all())


def unread_count(db: Session, user_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        )
        or 0
    )


def recent(db: Session, user_id: uuid.UUID, *, limit: int = 30) -> list[Notification]:
    return list(
        db.scalars(
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
            .limit(limit)
        )
    )


def mark_read(db: Session, user_id: uuid.UUID, ids: Sequence[uuid.UUID] | None = None) -> int:
    """Mark the user's notices read: the given ones, or all of them. Does not commit."""
    stmt = update(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    if ids is not None:
        stmt = stmt.where(Notification.id.in_(ids))
    return db.execute(stmt.values(read_at=now_utc())).rowcount  # type: ignore[attr-defined]


def deliver_pending_emails(db: Session, *, now: datetime | None = None) -> dict[str, int]:
    """Email the notices waiting for it, within the tenant's daily cap. Commits.

    Returns counts by outcome: sent, failed, skipped (no address, or no SMTP in
    development), deferred (over today's cap; they go out on a later run).
    """
    now = now or now_utc()
    sent_recently = (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.email_status == "sent", Notification.created_at >= now - timedelta(days=1))
        )
        or 0
    )
    budget = max(0, DAILY_EMAIL_CAP - sent_recently)
    pending_total = (
        db.scalar(select(func.count()).select_from(Notification).where(Notification.email_status == "pending")) or 0
    )
    rows = db.execute(
        select(Notification, User.email)
        .join(User, User.id == Notification.user_id)
        .where(Notification.email_status == "pending")
        .order_by(Notification.created_at)
        .limit(budget)
    ).all()
    outcome = {"sent": 0, "failed": 0, "skipped": 0, "deferred": pending_total - len(rows)}
    if not rows:
        return outcome
    with Mailer() as mailer:
        for notice, address in rows:
            if not address:
                notice.email_status = "skipped"
            else:
                try:
                    sent = mailer.send(to=address, subject=notice.title, text=_email_text(notice))
                    notice.email_status = "sent" if sent else "skipped"
                except Exception:
                    logger.exception("notification email failed", extra={"notification_id": str(notice.id)})
                    notice.email_status = "failed"
            outcome[notice.email_status] += 1
    db.commit()
    return outcome


def _email_text(notice: Notification) -> str:
    parts = [notice.body or notice.title]
    if notice.link:
        from ..core.config import settings

        parts.append(f"Open it in Oryza: {settings.FRONTEND_BASE_URL.rstrip('/')}{notice.link}")
    parts.append("You're receiving this because you use Oryza at your rice mill.")
    return "\n\n".join(parts)
