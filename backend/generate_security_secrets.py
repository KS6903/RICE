"""Generate the app's own production secrets, without a terminal, a log or a file
ever holding them.

By default each value goes straight into the Cloudflare Worker: it's handed to
``wrangler secret put`` on stdin, so it exists only in Cloudflare and there's
no file to forget to delete. (A leftover ``.env.production.secrets`` sat on
disk for weeks before this.)

  SECRET_KEY           signs sessions. Rotating it signs everyone out.
  MFA_ENCRYPTION_KEY   encrypts every two-factor seed. Never rotated here once
                       set: a new key would leave every user's 2FA unreadable.
  SIGNUP_INVITE_CODE   gates sign-up. Safe to rotate.

A secret the Worker already has is left alone unless it's named with --only,
so running this twice can't quietly replace a live key.

Usage, from backend/ (wrangler logged in, wrangler.jsonc naming the Worker):
    python generate_security_secrets.py                            # the missing ones
    python generate_security_secrets.py --only SIGNUP_INVITE_CODE  # rotate one
    python generate_security_secrets.py --env preview              # the private preview's
    python generate_security_secrets.py --output FILE              # a new file instead,
                                                                   # for another secret manager
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WRANGLER = REPO / "node_modules" / "wrangler" / "bin" / "wrangler.js"

GENERATORS: dict[str, Callable[[], str]] = {
    "SECRET_KEY": lambda: secrets.token_urlsafe(48),
    "MFA_ENCRYPTION_KEY": lambda: secrets.token_urlsafe(48),
    "SIGNUP_INVITE_CODE": lambda: secrets.token_urlsafe(32),
}
NEVER_ROTATE = {"MFA_ENCRYPTION_KEY"}

# (wrangler arguments, stdin) -> (exit status, stdout). Swapped out in tests.
Runner = Callable[[Sequence[str], "str | None"], "tuple[int, str]"]


def run_wrangler(args: Sequence[str], stdin: str | None) -> tuple[int, str]:
    node = shutil.which("node")
    if node is None or not WRANGLER.exists():
        raise SystemExit("wrangler isn't installed: run `npm ci` at the repository root first")
    # Output is captured, never echoed: a failed `secret put` mustn't print its input.
    result = subprocess.run([node, str(WRANGLER), *args], input=stdin, cwd=REPO, capture_output=True, text=True)
    return result.returncode, result.stdout


def _env_args(env: str | None) -> list[str]:
    return ["--env", env] if env else []


def existing_secrets(runner: Runner, env: str | None = None) -> set[str]:
    status, out = runner(["secret", "list", "--format", "json", *_env_args(env)], None)
    if status != 0:
        raise SystemExit(
            "couldn't list the Worker's secrets: is wrangler logged in, and does wrangler.jsonc name the Worker?"
        )
    start = out.find("[")
    try:
        return {item["name"] for item in json.loads(out[start:])} if start >= 0 else set()
    except (ValueError, KeyError, TypeError):
        raise SystemExit("couldn't read wrangler's list of secrets") from None


def put_secrets(names: Sequence[str], runner: Runner, env: str | None = None) -> list[str]:
    """Generate each named secret and hand it to the Worker. Returns what was set."""
    done: list[str] = []
    for name in names:
        status, _ = runner(["secret", "put", name, *_env_args(env)], GENERATORS[name]())
        if status != 0:
            raise SystemExit(f"wrangler couldn't set {name}; set before it: {', '.join(done) or 'none'}")
        done.append(name)
    return done


def write_file(path: Path) -> None:
    """A new mode-600 file; refuses to overwrite one."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, "".join(f"{name}={make()}\n" for name, make in GENERATORS.items()).encode("utf-8"))
    finally:
        os.close(fd)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def main(argv: Sequence[str] | None = None, runner: Runner = run_wrangler) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--only", nargs="+", choices=sorted(GENERATORS), help="set (or rotate) just these")
    parser.add_argument("--output", type=Path, help="write a new file instead of putting them into the Worker")
    parser.add_argument("--env", help="a wrangler.jsonc environment, e.g. preview (its own Worker and secrets)")
    args = parser.parse_args(argv)

    if args.output:
        if args.only:
            parser.error("--output writes all three; it can't be combined with --only")
        write_file(args.output)
        print(f"Created {args.output}. Move the values into your secret manager, then delete the file.")
        return 0

    have = existing_secrets(runner, args.env)
    if args.only:
        locked = sorted(NEVER_ROTATE & set(args.only) & have)
        if locked:
            parser.error(f"refusing to rotate {', '.join(locked)}: every user's two-factor seed is encrypted with it")
        names = list(args.only)
    else:
        names = [name for name in GENERATORS if name not in have]
        kept = [name for name in GENERATORS if name in have]
        if kept:
            print(f"Already set, left alone: {', '.join(kept)} (name one with --only to rotate it).")
        if not names:
            print("Nothing to do: the Worker has all three.")
            return 0

    done = put_secrets(names, runner, args.env)
    print(f"Set in the Worker: {', '.join(done)}. Nothing was written to disk.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
