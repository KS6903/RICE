"""Email for notifications and reports: text, optional HTML, attachments.

Separate from core/email.py on purpose. That module sends security-sensitive
account links (verification, password reset) one at a time and must never be
batched or logged. This one sends ordinary notices, many per run, over a single
SMTP connection:

    with Mailer() as mailer:
        for notice in pending:
            mailer.send(to=..., subject=..., text=...)

Without SMTP settings, development runs skip sending (send() returns False) and
production refuses to start a batch, the same fail-closed rule as account email.
"""

from __future__ import annotations

import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from types import TracebackType

from .config import settings
from .exceptions import NotConfiguredError


@dataclass(frozen=True)
class Attachment:
    filename: str
    content: bytes
    mime_type: str = "text/csv"


class Mailer:
    def __init__(self) -> None:
        self._smtp: smtplib.SMTP | None = None

    @property
    def configured(self) -> bool:
        return bool(settings.SMTP_HOST and settings.SMTP_FROM_EMAIL)

    def __enter__(self) -> Mailer:
        if not self.configured:
            if settings.email_required:
                raise NotConfiguredError("Email delivery is not configured")
            return self
        smtp = smtplib.SMTP(settings.SMTP_HOST or "", settings.SMTP_PORT, timeout=15)
        if settings.SMTP_STARTTLS:
            smtp.starttls()
        if settings.SMTP_USERNAME:
            smtp.login(
                settings.SMTP_USERNAME,
                settings.SMTP_PASSWORD.get_secret_value() if settings.SMTP_PASSWORD else "",
            )
        self._smtp = smtp
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self._smtp is not None:
            try:
                self._smtp.quit()
            except smtplib.SMTPException:
                pass
            self._smtp = None

    def send(
        self,
        *,
        to: str,
        subject: str,
        text: str,
        html: str | None = None,
        attachments: tuple[Attachment, ...] = (),
    ) -> bool:
        """Send one message. False means it was skipped (no SMTP in development)."""
        if self._smtp is None:
            return False
        message = build_message(to=to, subject=subject, text=text, html=html, attachments=attachments)
        self._smtp.send_message(message)
        return True


def build_message(
    *,
    to: str,
    subject: str,
    text: str,
    html: str | None = None,
    attachments: tuple[Attachment, ...] = (),
) -> EmailMessage:
    message = EmailMessage()
    message["From"] = settings.SMTP_FROM_EMAIL or ""
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text)
    if html is not None:
        # Callers pass HTML they built with html.escape on every value.
        message.add_alternative(html, subtype="html")
    for attachment in attachments:
        maintype, _, subtype = attachment.mime_type.partition("/")
        message.add_attachment(attachment.content, maintype=maintype, subtype=subtype, filename=attachment.filename)
    return message
