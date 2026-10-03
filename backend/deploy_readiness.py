"""Pre-deploy readiness gate: would the containers boot with this configuration?

Run by .github/workflows/deploy.yml before ``wrangler deploy`` (and runnable
locally from any directory). It rebuilds the exact environment worker/index.ts
hands each container (wrangler.jsonc vars + worker/container-env.json + dummy,
well-formed secrets) and runs the same fail-closed ``Settings`` validator the
API and the provisioner run at boot under ENV=prod, once per process role. That
includes the legal-placeholder check.

It also catches what the validator accepts but production would not survive:
template values still in wrangler.jsonc (example.com hosts, TODO: markers,
__PLACEHOLDER__ tokens), a var the Worker forwards that wrangler.jsonc does not
define, and more load-balanced API instances than the container may run.

Secrets are never read: the real ones live in Cloudflare, so dummies stand in
and only non-secret configuration is judged.

Exit status: 0 ready, 1 not ready (problems listed), 2 configuration unreadable.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
WRANGLER_CONFIG = REPO_ROOT / "wrangler.jsonc"
CONTAINER_ENV = REPO_ROOT / "worker" / "container-env.json"

# Values a template leaves behind. Checked against config values only, never
# comments (wrangler.jsonc carries a "TODO(deploy)" comment on purpose).
_TEMPLATE_VALUE_RE = re.compile(r"example\.(?:com|org|net)|\bTODO\b|__[A-Z0-9_]+__", re.IGNORECASE)


def _dummy_secrets(runtime_role: str) -> dict[str, str]:
    """Stand-ins that satisfy every secret-shaped check, so only real
    (non-secret) configuration problems surface."""
    return {
        "DATABASE_URL": f"postgresql://{runtime_role}:dummy@db.invalid:5432/oryza?sslmode=require",
        "PROVISIONER_DATABASE_URL": "postgresql://oryza_owner:dummy@db.invalid:5432/oryza?sslmode=require",
        "SECRET_KEY": "readiness-gate-dummy-0123456789abcdefghijklmnopqrstuvwxyz",
        "MFA_ENCRYPTION_KEY": "readiness-gate-mfa-0123456789abcdefghijklmnopqrstuvwxyz",
        "SIGNUP_INVITE_CODE": "readiness-gate-invite-0123456789",
        "REDIS_URL": "rediss://default:dummy@cache.invalid:6379",
        "SMTP_PASSWORD": "readiness-gate-smtp",
    }


# ── JSONC ─────────────────────────────────────────────────────────────────────


def strip_jsonc(text: str) -> str:
    """Remove // and /* */ comments and trailing commas, leaving strings intact.

    String-aware on purpose: URLs inside values contain "//".
    """
    out: list[str] = []
    i, n = 0, len(text)
    in_string = False
    while i < n:
        ch = text[i]
        if in_string:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
        elif text.startswith("//", i):
            end = text.find("\n", i)
            i = n if end == -1 else end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end == -1:
                raise ValueError("unterminated /* comment")
            i = end + 2
        else:
            out.append(ch)
            i += 1
    return _strip_trailing_commas("".join(out))


def _strip_trailing_commas(text: str) -> str:
    out: list[str] = []
    in_string = False
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if in_string:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
        elif ch == ",":
            j = i + 1
            while j < n and text[j].isspace():
                j += 1
            if j < n and text[j] in "}]":
                i += 1
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def load_jsonc(path: Path) -> Any:
    return json.loads(strip_jsonc(path.read_text(encoding="utf-8")))


# ── the environment each container boots with ─────────────────────────────────


def container_env(role: str, wrangler_vars: dict[str, Any], spec: dict[str, Any]) -> dict[str, str]:
    """Mirror of containerEnvFor() in worker/index.ts, with dummy secrets."""
    shared, role_spec = spec["shared"], spec["roles"][role]
    env: dict[str, str] = {**shared["constants"], **role_spec["constants"]}
    for key in shared["vars"]:
        if key in wrangler_vars:
            env[key] = str(wrangler_vars[key])
    secrets = _dummy_secrets(env.get("RUNTIME_DATABASE_ROLE", "ricemill_app"))
    for key in [*shared["secrets"], *role_spec["secrets"]]:
        env[key] = secrets[key]
    for key in shared["optional"]:
        value = wrangler_vars.get(key)
        if value:
            env[key] = str(value)
    return env


# ── checks ────────────────────────────────────────────────────────────────────


def template_value_problems(wrangler_vars: dict[str, Any]) -> list[str]:
    return [
        f"wrangler.jsonc var {key} still holds a template value: {value!r}"
        for key, value in sorted(wrangler_vars.items())
        if isinstance(value, str) and _TEMPLATE_VALUE_RE.search(value)
    ]


def missing_var_problems(wrangler_vars: dict[str, Any], spec: dict[str, Any]) -> list[str]:
    return [
        f"worker/container-env.json forwards {key}, but wrangler.jsonc vars does not define it"
        for key in spec["shared"]["vars"]
        if key not in wrangler_vars
    ]


def instance_problems(config: dict[str, Any]) -> list[str]:
    wrangler_vars = config.get("vars", {})
    try:
        instances = int(wrangler_vars.get("API_INSTANCES", "1"))
    except (TypeError, ValueError):
        return [f"API_INSTANCES must be an integer, got {wrangler_vars.get('API_INSTANCES')!r}"]
    api = next((c for c in config.get("containers", []) if c.get("class_name") == "ApiContainer"), None)
    if api is None:
        return ["wrangler.jsonc defines no ApiContainer"]
    max_instances = int(api.get("max_instances", 1))
    if instances > max_instances:
        return [
            f"API_INSTANCES ({instances}) exceeds ApiContainer max_instances ({max_instances}); "
            "the Worker would balance across instances that cannot start"
        ]
    return []


@contextlib.contextmanager
def _isolated_environ(field_names: set[str]) -> Iterator[None]:
    """Keep ambient variables from filling in fields the candidate leaves out."""
    saved = dict(os.environ)
    for key in list(os.environ):
        if key.upper() in field_names:
            del os.environ[key]
    try:
        yield
    finally:
        os.environ.clear()
        os.environ.update(saved)


def settings_problems(env: dict[str, str]) -> list[str]:
    """What the boot-time validator would refuse, one message per problem."""
    from pydantic import ValidationError

    from app.core.config import Settings

    with _isolated_environ({name.upper() for name in Settings.model_fields}):
        # As the container gets them: environment variables, and no .env file.
        os.environ.update(env)
        try:
            Settings(_env_file=None)
        except ValidationError as error:
            problems: list[str] = []
            for item in error.errors(include_input=False, include_url=False):
                message = str(item["msg"]).removeprefix("Value error, ")
                message = message.removeprefix("Insecure production configuration (ENV=prod): ")
                problems.extend(part.strip() for part in message.split("; ") if part.strip())
            return problems
    return []


def check(wrangler_path: Path = WRANGLER_CONFIG, container_env_path: Path = CONTAINER_ENV) -> list[str]:
    config = load_jsonc(wrangler_path)
    spec = json.loads(container_env_path.read_text(encoding="utf-8"))
    wrangler_vars = config.get("vars", {})
    problems = [
        *template_value_problems(wrangler_vars),
        *missing_var_problems(wrangler_vars, spec),
        *instance_problems(config),
    ]
    by_role = {role: settings_problems(container_env(role, wrangler_vars, spec)) for role in spec["roles"]}
    # Most failures (legal placeholders, origins) hit every role alike: report
    # those once, and name the role only where the roles differ.
    common = set.intersection(*(set(found) for found in by_role.values())) if by_role else set()
    first = next(iter(by_role.values()), [])
    problems.extend(problem for problem in first if problem in common)
    for role, found in by_role.items():
        problems.extend(f"{role} container: {problem}" for problem in found if problem not in common)
    return problems


def main() -> int:
    # app.core.config builds a module-level Settings() on import, from the
    # environment and a .env in the working directory. Import it from an empty
    # directory with throwaway values so a developer's .env cannot leak in.
    os.environ["DATABASE_URL"] = "postgresql://readiness:gate@localhost:5432/readiness"
    os.environ["SECRET_KEY"] = "readiness-gate-import-0123456789abcdefghijklmnop"
    os.environ.pop("ENV", None)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    original_cwd = Path.cwd()
    with tempfile.TemporaryDirectory() as empty:
        os.chdir(empty)
        try:
            problems = check()
        except (OSError, ValueError, KeyError) as error:
            print(f"Deploy readiness: could not read the configuration: {error}")
            return 2
        finally:
            # Windows cannot delete the directory it is standing in.
            os.chdir(original_cwd)
    if problems:
        print(f"Deploy readiness: NOT READY ({len(problems)} problem(s))")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("Deploy readiness: ready (both container roles pass the production checks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
