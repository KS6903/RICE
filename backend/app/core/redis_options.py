"""How every Redis client in the app connects: the cache, and the rate
limiter's storage.

Redis here is an accelerator, never a dependency. When it's down, the cache
reads PostgreSQL and the limiter falls back to memory, so a Redis call must
fail fast:

- half-second socket timeouts, so the OS's 5-10 s TCP timeout never applies;
- no retries, said outright. redis-py's defaults keep moving (6.0 and 8.0 both
  changed them) and differ by constructor: today ``redis.Redis()`` retries 10
  times with back-off while ``from_url`` doesn't retry at all;
- RESP2 on the wire. redis-py 8 switched ``from_url`` to RESP3; RESP2 is the
  protocol this app was built and tested on, Upstash included.
"""

from __future__ import annotations

from typing import Any


def redis_client_options() -> dict[str, Any]:
    # Imported here: the cache treats the redis package as optional.
    from redis.backoff import NoBackoff
    from redis.retry import Retry

    return {
        "socket_connect_timeout": 0.5,
        "socket_timeout": 0.5,
        "retry": Retry(NoBackoff(), 0),
        "protocol": 2,
    }
