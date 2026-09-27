"""Fail when a pip-compile input and its hash-pinned lock disagree.

Each ``*.in`` file is the input; the ``*.txt`` beside it is pip-compile's
hash-pinned output, which CI and the container install with --require-hashes.
A pin that changes in the input without the lock being regenerated (a
hand edit, or a Dependabot update that failed to relock) would ship untested,
because installs only ever read the lock. This check catches that, plus a
lock header that would make the next relock misbehave.

Run from anywhere: python backend/scripts/check_lockfiles.py
"""

from __future__ import annotations

import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PAIRS = [
    ("requirements.in", "requirements.txt"),
    ("requirements-dev.in", "requirements-dev.txt"),
]

_PIN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?==([^\s;\\#]+)")


def _normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def pins(text: str) -> dict[str, str]:
    """Exact ``name==version`` pins, keyed by normalized project name."""
    found: dict[str, str] = {}
    for line in text.splitlines():
        match = _PIN.match(line.strip())
        if match:
            found[_normalize(match.group(1))] = match.group(2)
    return found


def source_pins(source: Path) -> dict[str, str]:
    """Pins in an input file, including inputs it pulls in with ``-r``."""
    found: dict[str, str] = {}
    text = source.read_text(encoding="utf-8")
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] in ("-r", "--requirement"):
            found.update(source_pins(source.parent / parts[1]))
    found.update(pins(text))
    return found


def compile_command(lock_text: str) -> list[str]:
    """The pip-compile command recorded in a lock's header, as arguments."""
    for line in lock_text.splitlines()[:10]:
        words = line.lstrip("#").split()
        if words[:1] == ["pip-compile"]:
            return words
    return []


def problems_for(source: Path, lock: Path) -> list[str]:
    problems: list[str] = []
    lock_text = lock.read_text(encoding="utf-8")
    command = compile_command(lock_text)
    if not command:
        problems.append(f"{lock.name}: no pip-compile header; regenerate it from {source.name}")
    elif f"--output-file={lock.name}" not in command or command[-1] != source.name:
        problems.append(f"{lock.name}: header does not compile {source.name} into {lock.name}")
    # pip-tools with a newer Click than it supports records flags that were
    # never set; Dependabot re-runs the header's command, so it must be exact.
    if "--no-index" in command:
        problems.append(f"{lock.name}: header records --no-index; relock with the Click version the lock pins")
    locked = pins(lock_text)
    for name, version in sorted(source_pins(source).items()):
        if name not in locked:
            problems.append(f"{source.name} pins {name}=={version}, but {lock.name} does not list {name}")
        elif locked[name] != version:
            problems.append(f"{source.name} pins {name}=={version}, but {lock.name} has {name}=={locked[name]}")
    return problems


def main() -> int:
    problems = [p for source, lock in PAIRS for p in problems_for(BACKEND / source, BACKEND / lock)]
    if problems:
        print("Lockfiles are out of date with their inputs. Relock under Python 3.11 (see the .in headers):")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("Lockfiles match their inputs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
