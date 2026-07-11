"""Minimal SMTP delivery for security-sensitive account links.

Raw reset and verification tokens must leave the application only through the
recipient's mailbox. They are never written to application logs.
"""
from __future__ import annotations

import smtplib
from email.message import EmailMessage

from .config import settings
from .exceptions import NotConfiguredError


def send_account_email(*, to: str, subject: str, text: str) -> None:
    if not settings.SMTP_HOST or not settings.SMTP_FROM_EMAIL:
        if settings.is_prod:
            raise NotConfiguredError("Account email delivery is not configured")
        return

    message = EmailMessage()
    message["From"] = settings.SMTP_FROM_EMAIL
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text)

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
        if settings.SMTP_STARTTLS:
            smtp.starttls()
        if settings.SMTP_USERNAME:
            smtp.login(
                settings.SMTP_USERNAME,
                settings.SMTP_PASSWORD.get_secret_value() if settings.SMTP_PASSWORD else "",
            )
        smtp.send_message(message)
