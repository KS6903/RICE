"""The pre-deploy readiness gate must pass a real config and name every blocker."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import deploy_readiness as gate
from app.core import legal

READY_VARS = {
    "API_INSTANCES": "3",
    "RUNTIME_DATABASE_ROLE": "ricemill_app",
    "ALLOWED_ORIGINS": "https://app.oryza.ph",
    "TRUSTED_HOSTS": "app.oryza.ph",
    "FRONTEND_BASE_URL": "https://app.oryza.ph",
    "COOKIE_DOMAIN": "",
    "MFA_REQUIRED_ROLES": "owner,admin",
    "SMTP_HOST": "smtp.mailprovider.net",
    "SMTP_PORT": "587",
    "SMTP_FROM_EMAIL": "no-reply@oryza.ph",
    "SMTP_USERNAME": "no-reply@oryza.ph",
}


@pytest.fixture(autouse=True)
def _legal_docs_filled_in(monkeypatch):
    """Legal placeholders have their own test below; keep them out of the rest."""
    monkeypatch.setattr(legal, "unresolved_placeholders", lambda: [])


def _wrangler(tmp_path: Path, overrides=None, *, max_instances=3, drop=()) -> Path:
    """A wrangler.jsonc shaped like the real one: comments, URLs, trailing commas."""
    values = {**READY_VARS, **(overrides or {})}
    for key in drop:
        values.pop(key)
    body = ",\n    ".join(f"{json.dumps(k)}: {json.dumps(v)}" for k, v in values.items())
    path = tmp_path / "wrangler.jsonc"
    path.write_text(
        "{\n"
        "  // TODO(deploy): comments never count as template values.\n"
        '  "name": "oryza",\n'
        '  "containers": [\n'
        f'    {{ "class_name": "ApiContainer", "max_instances": {max_instances} }}, /* inline */\n'
        '    { "class_name": "ProvisionerContainer", "max_instances": 1 },\n'
        "  ],\n"
        f'  "vars": {{\n    {body},\n  }},\n'
        "}\n",
        encoding="utf-8",
    )
    return path


def _check(path: Path) -> list[str]:
    return gate.check(path, gate.CONTAINER_ENV)


def test_strip_jsonc_keeps_urls_and_escaped_quotes():
    text = '{"a": "https://x.test/p", // tail\n "b": "quote \\" // not a comment", /* c */ "c": [1, 2,],}'
    assert json.loads(gate.strip_jsonc(text)) == {
        "a": "https://x.test/p",
        "b": 'quote " // not a comment',
        "c": [1, 2],
    }


def test_ready_configuration_passes(tmp_path):
    assert _check(_wrangler(tmp_path)) == []


def test_template_values_block_the_deploy(tmp_path):
    problems = _check(
        _wrangler(
            tmp_path,
            {
                "ALLOWED_ORIGINS": "https://app.example.com",
                "SMTP_HOST": "__SMTP_HOST__",
                "SMTP_USERNAME": "TODO: fill in",
            },
        )
    )
    flagged = [p for p in problems if "template value" in p]
    assert [p.split()[2] for p in flagged] == ["ALLOWED_ORIGINS", "SMTP_HOST", "SMTP_USERNAME"]


def test_a_forwarded_var_missing_from_wrangler_is_named(tmp_path):
    problems = _check(_wrangler(tmp_path, drop=("TRUSTED_HOSTS",)))
    assert any("forwards TRUSTED_HOSTS" in p for p in problems)
    # With the var absent the validator sees the "*" default, as the container would.
    assert any("TRUSTED_HOSTS must be an explicit allowlist" in p for p in problems)


def test_more_api_instances_than_containers_is_a_blocker(tmp_path):
    problems = _check(_wrangler(tmp_path, {"API_INSTANCES": "4"}, max_instances=3))
    assert problems == [
        "API_INSTANCES (4) exceeds ApiContainer max_instances (3); "
        "the Worker would balance across instances that cannot start"
    ]


def test_legal_placeholders_are_reported_once_not_per_role(tmp_path, monkeypatch):
    todo = "terms-of-service.md: entity.json 'venue_city' is still a TODO placeholder"
    monkeypatch.setattr(legal, "unresolved_placeholders", lambda: [todo])
    assert _check(_wrangler(tmp_path)) == [f"legal document placeholder unfilled: {todo}"]


def test_a_problem_in_one_role_names_that_role(tmp_path, monkeypatch):
    original = gate._dummy_secrets

    def provisioner_without_tls(runtime_role: str) -> dict[str, str]:
        secrets = original(runtime_role)
        secrets["PROVISIONER_DATABASE_URL"] = "postgresql://owner:x@db.invalid:5432/oryza"
        return secrets

    monkeypatch.setattr(gate, "_dummy_secrets", provisioner_without_tls)
    assert _check(_wrangler(tmp_path)) == ["provisioner container: PROVISIONER_DATABASE_URL must require TLS"]


def test_ambient_environment_cannot_mask_a_missing_value(tmp_path, monkeypatch):
    # A developer shell exporting a good value must not make a broken deploy
    # config look valid: the container would not have that variable.
    monkeypatch.setenv("FRONTEND_BASE_URL", "https://app.oryza.ph")
    problems = _check(_wrangler(tmp_path, drop=("FRONTEND_BASE_URL",)))
    assert "FRONTEND_BASE_URL must use HTTPS" in problems


def test_container_env_mirrors_the_worker_roles():
    spec = json.loads(gate.CONTAINER_ENV.read_text(encoding="utf-8"))
    api = gate.container_env("api", READY_VARS, spec)
    provisioner = gate.container_env("provisioner", READY_VARS, spec)
    assert api["PROCESS_ROLE"] == "api"
    assert provisioner["PROCESS_ROLE"] == "provisioner"
    # The DDL credential exists only in the provisioner's environment.
    assert "PROVISIONER_DATABASE_URL" not in api
    assert "PROVISIONER_DATABASE_URL" in provisioner
    # Empty optional values are not forwarded (host-only cookie on workers.dev).
    assert "COOKIE_DOMAIN" not in api
