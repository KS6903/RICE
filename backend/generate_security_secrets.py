"""Generate production secrets without echoing them to terminal or logs."""

from __future__ import annotations

import argparse
import os
import secrets
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(".env.production.secrets"),
        help="New file to create (refuses to overwrite)",
    )
    args = parser.parse_args()
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(args.output, flags, 0o600)
    try:
        payload = (
            f"SECRET_KEY={secrets.token_urlsafe(48)}\n"
            f"MFA_ENCRYPTION_KEY={secrets.token_urlsafe(48)}\n"
            f"SIGNUP_INVITE_CODE={secrets.token_urlsafe(32)}\n"
        )
        os.write(fd, payload.encode("utf-8"))
    finally:
        os.close(fd)
    try:
        os.chmod(args.output, 0o600)
    except OSError:
        pass
    print(f"Created {args.output}; move these values into the deployment secret manager.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
