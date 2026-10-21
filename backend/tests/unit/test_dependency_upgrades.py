"""What bcrypt 5 and redis-py 8 changed, held to what the app relies on."""

from __future__ import annotations

import os
import socket
import time

import bcrypt
import pytest
import redis

from app.core.ratelimit import limiter
from app.core.redis_options import redis_client_options
from app.core.security import hash_password, verify_password

# ── bcrypt 5: more than 72 bytes now raises instead of being truncated ──────

LONG = "ñ" * 40 + "password123"  # 91 UTF-8 bytes, 51 characters


def test_a_long_password_hashed_under_bcrypt_4_still_signs_in():
    # bcrypt 4 hashed only the first 72 bytes and dropped the rest.
    legacy = bcrypt.hashpw(LONG.encode("utf-8")[:72], bcrypt.gensalt(rounds=4)).decode("ascii")
    assert verify_password(LONG, legacy)


def test_a_long_wrong_password_is_refused_not_crashed():
    stored = hash_password("correct-horse-9")
    assert verify_password(LONG, stored) is False


def test_new_hashes_still_refuse_more_than_72_bytes():
    # passwords.py caps new passwords at 72 bytes; bcrypt 5 enforces it too.
    with pytest.raises(ValueError):
        hash_password(LONG)


# ── redis-py 8: RESP3 by default, and defaults that keep moving ──────────────


def test_clients_speak_resp2_and_never_retry():
    options = redis_client_options()
    assert options["protocol"] == 2
    assert options["retry"].get_retries() == 0
    assert options["socket_timeout"] <= 0.5 and options["socket_connect_timeout"] <= 0.5


def test_the_rate_limiter_uses_the_same_options():
    if not limiter._storage_uri.startswith("redis"):
        pytest.skip("rate limiting uses memory storage in this environment")
    assert limiter._storage_options["retry"].get_retries() == 0


def _closed_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_a_dead_redis_gets_one_short_attempt(monkeypatch):
    """One half-second attempt, then the fallback: no retries, whatever the defaults become.

    The attempts are counted, not just timed: on Windows a closed port waits out
    the connect timeout instead of refusing, so one attempt on a busy machine
    can pass a second, while two attempts on Linux take milliseconds.
    """
    attempts = []
    connect = redis.connection.Connection._connect

    def counted_connect(self):
        attempts.append(self.port)
        return connect(self)

    monkeypatch.setattr(redis.connection.Connection, "_connect", counted_connect)
    client = redis.from_url(f"redis://127.0.0.1:{_closed_port()}/0", **redis_client_options())
    started = time.monotonic()
    # Refused on Linux; on Windows a closed port times out instead.
    with pytest.raises((redis.ConnectionError, redis.TimeoutError)):
        client.ping()
    assert len(attempts) == 1
    # Far below the system's own connect timeout (about 21 s on Windows), so the
    # half-second socket_connect_timeout is what ended the attempt.
    assert time.monotonic() - started < 5.0


@pytest.mark.skipif(not os.environ.get("REDIS_TEST_URL"), reason="set REDIS_TEST_URL to run against a real Redis")
def test_a_real_redis_round_trip():
    client = redis.from_url(os.environ["REDIS_TEST_URL"], decode_responses=True, **redis_client_options())
    client.set("ricemill:test:upgrade", "ok", ex=10)
    assert client.get("ricemill:test:upgrade") == "ok"
    assert client.incr("ricemill:test:counter") >= 1
    client.delete("ricemill:test:upgrade", "ricemill:test:counter")
