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

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ..core.mailer import Attachment, Mailer
from ..models.base import now_utc
from ..models.notification import Notification, NotificationAttachment
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


KEEP_ATTACHMENTS_FOR = timedelta(days=14)


def attach(db: Session, *, company_id: uuid.UUID, dedupe_key: str, attachments: Sequence[Attachment]) -> None:
    """Keep files to email with every notice under ``dedupe_key``. Does not commit."""
    rows = [
        {
            "id": uuid.uuid4(),
            "company_id": company_id,
            "dedupe_key": dedupe_key[:120],  # as notify() stores it
            "filename": a.filename[:120],
            "mime_type": a.mime_type,
            "content": a.content,
        }
        for a in attachments
    ]
    if rows:
        db.execute(
            insert(NotificationAttachment)
            .values(rows)
            .on_conflict_do_nothing(constraint="uq_notification_attachments_key_file")
        )


def prune_attachments(db: Session, *, now: datetime) -> int:
    """Delete attachments older than KEEP_ATTACHMENTS_FOR; their emails went out
    long ago. Does not commit."""
    result = db.execute(
        delete(NotificationAttachment).where(NotificationAttachment.created_at < now - KEEP_ATTACHMENTS_FOR)
    )
    return result.rowcount  # type: ignore[attr-defined]


def _attachments_for(db: Session, keys: set[str]) -> dict[str, tuple[Attachment, ...]]:
    found: dict[str, list[Attachment]] = {}
    if keys:
        for row in db.scalars(select(NotificationAttachment).where(NotificationAttachment.dedupe_key.in_(keys))):
            found.setdefault(row.dedupe_key, []).append(Attachment(row.filename, row.content, row.mime_type))
    return {key: tuple(files) for key, files in found.items()}


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


# How long a failed email waits before each retry. A mail server down for an
# hour or a full mailbox shouldn't lose a collections reminder; after the last
# retry the notice is marked failed (it's still under the bell).
RETRY_AFTER = (timedelta(minutes=15), timedelta(hours=1), timedelta(hours=4))


def _ready(now: datetime):
    """Pending notices whose next try is due."""
    return (Notification.email_status == "pending") & (
        Notification.email_retry_at.is_(None) | (Notification.email_retry_at <= now)
    )


def deliver_pending_emails(db: Session, *, now: datetime | None = None) -> dict[str, int]:
    """Email the notices waiting for it, within the tenant's daily cap. Commits.

    Returns counts by outcome: sent, retrying (failed this time, tried again
    later), failed (every retry used), skipped (no address, or no SMTP in
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
    ready_total = db.scalar(select(func.count()).select_from(Notification).where(_ready(now))) or 0
    rows = db.execute(
        select(Notification, User.email)
        .join(User, User.id == Notification.user_id)
        .where(_ready(now))
        .order_by(Notification.created_at)
        .limit(budget)
    ).all()
    outcome = {"sent": 0, "retrying": 0, "failed": 0, "skipped": 0, "deferred": ready_total - len(rows)}
    if not rows:
        return outcome
    files = _attachments_for(db, {notice.dedupe_key for notice, _ in rows})
    with Mailer() as mailer:
        for notice, address in rows:
            if not address:
                notice.email_status = "skipped"
                outcome["skipped"] += 1
                continue
            try:
                sent = mailer.send(
                    to=address,
                    subject=notice.title,
                    text=_email_text(notice),
                    attachments=files.get(notice.dedupe_key, ()),
                )
            except Exception:
                logger.exception("notification email failed", extra={"notification_id": str(notice.id)})
                outcome[_failed(notice, now)] += 1
                continue
            notice.email_status = "sent" if sent else "skipped"
            notice.email_retry_at = None
            outcome[notice.email_status] += 1
    db.commit()
    return outcome


def _failed(notice: Notification, now: datetime) -> str:
    """Count a failed send: schedule the next try, or give up. Returns the outcome."""
    notice.email_attempts = (notice.email_attempts or 0) + 1
    if notice.email_attempts <= len(RETRY_AFTER):
        notice.email_retry_at = now + RETRY_AFTER[notice.email_attempts - 1]
        return "retrying"
    notice.email_status = "failed"
    notice.email_retry_at = None
    return "failed"


def undelivered_emails(db: Session, *, kind_prefix: str, since: datetime) -> dict[str, int]:
    """Emails of notices whose kind starts with ``kind_prefix``, created since
    ``since``, that haven't reached anyone: given up on, or still retrying."""
    rows = db.execute(
        select(Notification.email_status, func.count())
        .where(
            Notification.kind.startswith(kind_prefix),
            Notification.created_at >= since,
            (Notification.email_status == "failed")
            | ((Notification.email_status == "pending") & (Notification.email_attempts > 0)),
        )
        .group_by(Notification.email_status)
    ).all()
    counts: dict[str, int] = {status: count for status, count in rows}
    return {"failed": counts.get("failed", 0), "retrying": counts.get("pending", 0)}


def _email_text(notice: Notification) -> str:
    parts = [notice.body or notice.title]
    if notice.link:
        from ..core.config import settings

        parts.append(f"Open it in Oraiza: {settings.FRONTEND_BASE_URL.rstrip('/')}{notice.link}")
    parts.append("You're receiving this because you use Oraiza at your rice mill.")
    return "\n\n".join(parts)
