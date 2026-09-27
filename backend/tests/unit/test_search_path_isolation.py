"""A session's tenant schema must hold for its whole life, whatever else happens.

The session releases its pooled connection at every commit and takes one again
for the next transaction, and a rollback undoes anything set inside the rolled-
back transaction. The schema therefore has to be re-applied to every transaction
the session begins, never left as connection state for the next borrower.

These tests use their own one-connection engine, so two sessions are guaranteed
to share a connection one after the other: the situation concurrent requests
create in production.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.database import engine as app_engine
from app.core.tenancy import set_search_path

SCHEMA_A = "client_" + "a" * 32
SCHEMA_B = "client_" + "b" * 32


@pytest.fixture
def one_connection_sessions():
    # SET search_path accepts schemas that don't exist, so none are created here.
    engine = create_engine(app_engine.url, pool_size=1, max_overflow=0)
    make = sessionmaker(bind=engine, autoflush=False)
    try:
        yield make
    finally:
        engine.dispose()


def _search_path(session) -> str:
    # SHOW quotes an identifier only when it needs quoting; compare without them.
    return session.execute(text("SHOW search_path")).scalar_one().replace('"', "")


def test_schema_holds_after_another_session_reuses_the_connection(one_connection_sessions):
    first, second = one_connection_sessions(), one_connection_sessions()
    try:
        set_search_path(first, SCHEMA_A)
        first.commit()  # first gives the only connection back to the pool
        set_search_path(second, SCHEMA_B)
        second.commit()  # ...second borrows that same connection and points it at B
        assert _search_path(first) == f"{SCHEMA_A}, public"
    finally:
        first.close()
        second.close()


def test_schema_holds_after_a_rollback(one_connection_sessions):
    session = one_connection_sessions()
    try:
        set_search_path(session, SCHEMA_A)
        session.rollback()
        assert _search_path(session) == f"{SCHEMA_A}, public"
    finally:
        session.close()


def test_no_schema_leaks_to_the_next_borrower(one_connection_sessions):
    tenant, unauthenticated = one_connection_sessions(), one_connection_sessions()
    try:
        set_search_path(tenant, SCHEMA_A)
        tenant.commit()
        tenant.close()
        # A session that never picked a schema must see only the default path,
        # not whatever the last borrower of the connection used.
        assert SCHEMA_A not in _search_path(unauthenticated)
    finally:
        unauthenticated.close()


def test_invalid_schema_falls_back_to_public(one_connection_sessions):
    session = one_connection_sessions()
    try:
        set_search_path(session, 'client_x"; DROP TABLE users; --')
        assert _search_path(session) == "public"
        session.commit()
        assert _search_path(session) == "public"
    finally:
        session.close()
