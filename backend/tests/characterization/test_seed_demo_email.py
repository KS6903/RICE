"""seed_demo_email.py: a confirmed example.com address for a test Boss who has
no email, and never a change to one who has."""

from __future__ import annotations

import seed_demo_email


def test_a_boss_without_an_email_gets_a_confirmed_one(db_session, seed_owner):
    seed_owner.email = None
    seed_owner.email_verified = False
    db_session.flush()

    assert seed_demo_email.seed(db_session, "owner") == "owner: email owner@example.com"
    db_session.refresh(seed_owner)
    assert (seed_owner.email, seed_owner.email_verified) == ("owner@example.com", True)

    # Again: nothing changes.
    assert seed_demo_email.seed(db_session, "owner") == "owner: already has an email"


def test_an_existing_email_is_kept(db_session, seed_owner):
    seed_owner.email = "boss@mill.ph"
    db_session.flush()

    assert seed_demo_email.seed(db_session, "owner") == "owner: already has an email"
    db_session.refresh(seed_owner)
    assert seed_owner.email == "boss@mill.ph"
