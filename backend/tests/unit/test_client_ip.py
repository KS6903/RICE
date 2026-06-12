"""Proxy-aware client-IP resolution for rate limiting (hardening — phase 6).

X-Forwarded-For is client-spoofable, so it's trusted only when explicitly enabled
(behind a proxy) and the client IP is taken from the RIGHT — the hops our own
proxies appended. Prepended (spoofed) entries on the left are ignored.
"""
from types import SimpleNamespace

import pytest

import app.core.config as cfg
from app.core.ratelimit import client_ip


def _req(xff: str | None = None, host: str = "203.0.113.9"):
    headers = {"X-Forwarded-For": xff} if xff is not None else {}
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=host))


def test_ignores_forwarded_header_by_default(monkeypatch):
    monkeypatch.setattr(cfg.settings, "RATE_LIMIT_TRUST_FORWARDED_FOR", False, raising=False)
    # XFF present but trust is off → use the real socket peer.
    assert client_ip(_req(xff="1.2.3.4", host="10.0.0.1")) == "10.0.0.1"


def test_uses_rightmost_hop_and_ignores_spoof(monkeypatch):
    monkeypatch.setattr(cfg.settings, "RATE_LIMIT_TRUST_FORWARDED_FOR", True, raising=False)
    monkeypatch.setattr(cfg.settings, "RATE_LIMIT_FORWARDED_HOPS", 1, raising=False)
    # Attacker prepends a spoofed IP; our proxy appended the real one on the right.
    assert client_ip(_req(xff="9.9.9.9, 1.2.3.4", host="10.0.0.1")) == "1.2.3.4"


def test_counts_configured_number_of_hops(monkeypatch):
    monkeypatch.setattr(cfg.settings, "RATE_LIMIT_TRUST_FORWARDED_FOR", True, raising=False)
    monkeypatch.setattr(cfg.settings, "RATE_LIMIT_FORWARDED_HOPS", 2, raising=False)
    # Two trusted proxies: client, proxy1 — client is two from the right.
    assert client_ip(_req(xff="1.2.3.4, 70.0.0.1", host="10.0.0.1")) == "1.2.3.4"


def test_falls_back_to_socket_without_forwarded_header(monkeypatch):
    monkeypatch.setattr(cfg.settings, "RATE_LIMIT_TRUST_FORWARDED_FOR", True, raising=False)
    assert client_ip(_req(xff=None, host="10.0.0.1")) == "10.0.0.1"


@pytest.mark.parametrize("xff", ["", "   "])
def test_blank_forwarded_header_falls_back(monkeypatch, xff):
    monkeypatch.setattr(cfg.settings, "RATE_LIMIT_TRUST_FORWARDED_FOR", True, raising=False)
    assert client_ip(_req(xff=xff, host="10.0.0.1")) == "10.0.0.1"
