"""generate_security_secrets.py puts new secrets straight into the Worker,
never onto disk or a screen, and never replaces a live key by accident."""

from __future__ import annotations

import json
import os

import pytest

import generate_security_secrets as gen


class FakeWrangler:
    def __init__(self, existing=(), fail_on=None):
        self.existing = list(existing)
        self.fail_on = fail_on
        self.put: dict[str, str] = {}

    def __call__(self, args, stdin):
        if args[:2] == ["secret", "list"]:
            return 0, "🌀 noise before the JSON\n" + json.dumps(
                [{"name": n, "type": "secret_text"} for n in self.existing]
            )
        if args[:2] == ["secret", "put"]:
            if args[2] == self.fail_on:
                return 1, ""
            self.put[args[2]] = stdin
            return 0, "✨ Success! Uploaded secret"
        raise AssertionError(args)


def test_a_new_worker_gets_all_three_and_nothing_is_printed_or_written(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    wrangler = FakeWrangler()
    assert gen.main([], runner=wrangler) == 0
    assert set(wrangler.put) == {"SECRET_KEY", "MFA_ENCRYPTION_KEY", "SIGNUP_INVITE_CODE"}
    assert all(len(value) >= 32 for value in wrangler.put.values())
    assert len(set(wrangler.put.values())) == 3
    out = capsys.readouterr().out
    assert not any(value in out for value in wrangler.put.values())
    assert os.listdir(tmp_path) == []


def test_running_it_again_replaces_nothing(capsys):
    wrangler = FakeWrangler(existing=["SECRET_KEY", "MFA_ENCRYPTION_KEY", "SIGNUP_INVITE_CODE"])
    assert gen.main([], runner=wrangler) == 0
    assert wrangler.put == {}
    assert "Nothing to do" in capsys.readouterr().out


def test_only_the_missing_ones_are_set():
    wrangler = FakeWrangler(existing=["SECRET_KEY", "MFA_ENCRYPTION_KEY"])
    gen.main([], runner=wrangler)
    assert list(wrangler.put) == ["SIGNUP_INVITE_CODE"]


def test_a_named_secret_is_rotated():
    wrangler = FakeWrangler(existing=["SECRET_KEY", "MFA_ENCRYPTION_KEY", "SIGNUP_INVITE_CODE"])
    gen.main(["--only", "SIGNUP_INVITE_CODE"], runner=wrangler)
    assert list(wrangler.put) == ["SIGNUP_INVITE_CODE"]


def test_the_mfa_key_is_never_rotated(capsys):
    wrangler = FakeWrangler(existing=["MFA_ENCRYPTION_KEY"])
    with pytest.raises(SystemExit):
        gen.main(["--only", "MFA_ENCRYPTION_KEY", "SECRET_KEY"], runner=wrangler)
    assert wrangler.put == {}
    assert "two-factor" in capsys.readouterr().err


def test_a_failed_put_says_what_was_already_set():
    wrangler = FakeWrangler(fail_on="MFA_ENCRYPTION_KEY")
    with pytest.raises(SystemExit, match="set before it: SECRET_KEY"):
        gen.main([], runner=wrangler)


def test_the_file_mode_still_exists_and_never_overwrites(tmp_path):
    target = tmp_path / "secrets.env"
    assert gen.main(["--output", str(target)], runner=FakeWrangler()) == 0
    assert [line.split("=")[0] for line in target.read_text().splitlines()] == list(gen.GENERATORS)
    with pytest.raises(FileExistsError):
        gen.main(["--output", str(target)], runner=FakeWrangler())
