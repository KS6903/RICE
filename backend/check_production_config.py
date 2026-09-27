"""Validate a candidate production env file without printing secret values."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from dotenv import dotenv_values
from pydantic import ValidationError


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("env_file", type=Path)
    args = parser.parse_args()
    if not args.env_file.is_file():
        print("Configuration file not found.")
        return 2
    # Validate the candidate file itself. Ambient shell variables must not
    # silently replace values and make a broken deployment file look valid.
    values = {key: value for key, value in dotenv_values(args.env_file).items() if value is not None}
    preserved = {
        key: os.environ[key]
        for key in (
            "HOME",
            "PATH",
            "PYTHONPATH",
            "SYSTEMROOT",
            "TEMP",
            "TMP",
            "USERPROFILE",
            "WINDIR",
        )
        if key in os.environ
    }
    os.environ.clear()
    os.environ.update(preserved)
    os.environ.update(values)
    try:
        from app.core.config import settings
    except ValidationError as error:
        print("Production configuration is invalid:")
        for item in error.errors(include_input=False, include_url=False):
            print(f"- {item['msg']}")
        return 1
    if not settings.is_prod:
        print("Configuration is valid but ENV is not prod.")
        return 1
    print("Production configuration passed all fail-closed checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
