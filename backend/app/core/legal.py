"""Legal document registry.

The authoritative text of every published agreement lives as markdown under
``legal/`` at the repository root, with company-specific values kept in one
place (``legal/entity.json``) and substituted at render time. Nothing here
talks to the database; the acceptance ledger is in services/legal_service.py.

Two properties matter for this module, both of them evidentiary:

* **Versioning.** Each document carries a version and an effective date. The
  set of documents a user accepts in one click is the *agreement bundle*, and
  the bundle has its own version. Bumping ``AGREEMENT_VERSION`` is what makes
  every existing user re-accept, so it is a deliberate edit, never derived.
* **Content hashing.** Every acceptance stores the SHA-256 of the exact text
  that was on screen. If a dispute later turns on what the terms said, the
  hash either matches a stored version of the document or it does not, and
  neither side has to take the other's word for it.

Placeholders that were never filled in (the ``TODO:`` sentinels in
entity.json) are treated as a release blocker rather than cosmetic: shipping a
Terms of Service that names no legal entity and no venue is worse than
shipping none, because it invites the argument that no agreement was formed.
``unresolved_placeholders()`` backs both a unit test and the production config
check.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path

# Bump when any document in the bundle changes materially. This forces every
# account back through the acceptance gate, so treat it as a product decision:
# a typo fix does not warrant it, a new limitation of liability does.
AGREEMENT_VERSION = "2026.11.1"

_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-z0-9_]+)\s*\}\}")
_TODO_SENTINEL = "TODO:"
# What a reader sees where an entity.json value is still a TODO: the note after
# "TODO:" is for us, not for customers. The web Markdown renderer greys out
# [[...]]. This changes only the display; unresolved_placeholders() reads
# entity.json itself, so the production gate still refuses to boot.
PENDING_MARKER = "[[To follow]]"


@dataclass(frozen=True)
class LegalDocument:
    key: str
    title: str
    version: str
    effective_date: date
    filename: str
    summary: str
    # Documents in the bundle are covered by the single signup acceptance.
    in_bundle: bool = True
    # Extra substitutions that are not company-wide entity values.
    extra_tokens: dict[str, str] = field(default_factory=dict)


DOCUMENTS: tuple[LegalDocument, ...] = (
    LegalDocument(
        key="terms",
        title="Terms of Service",
        version="1.0",
        effective_date=date(2026, 9, 24),
        filename="terms-of-service.md",
        summary="The contract between your mill and us, including what the Service is not, the "
        "warranty disclaimer, and the limit on our liability.",
    ),
    LegalDocument(
        key="privacy",
        title="Privacy Policy",
        version="1.1",
        effective_date=date(2026, 11, 3),
        filename="privacy-policy.md",
        summary="How we handle personal information under the Data Privacy Act of 2012, and the "
        "rights you have over it.",
    ),
    LegalDocument(
        key="dpa",
        title="Data Processing Addendum",
        version="1.1",
        effective_date=date(2026, 11, 3),
        filename="data-processing-addendum.md",
        summary="The written outsourcing contract required by section 21 of the Data Privacy Act, "
        "covering security measures, sub-processors, audit and breach notification.",
    ),
    LegalDocument(
        key="aup",
        title="Acceptable Use Policy",
        version="1.0",
        effective_date=date(2026, 9, 24),
        filename="acceptable-use-policy.md",
        summary="What you may not do with the Service.",
    ),
    LegalDocument(
        key="subprocessors",
        title="Sub-processor register",
        version="1.1",
        effective_date=date(2026, 11, 3),
        filename="subprocessors.md",
        summary="Every third party that processes data for us, what it receives, and where.",
        # Informational: it changes on its own 30-day notice cycle and must not
        # drag every tenant back through the acceptance gate when it does.
        in_bundle=False,
    ),
    LegalDocument(
        key="employee-notice",
        title="Employee privacy notice template",
        version="1.0",
        effective_date=date(2026, 9, 24),
        filename="templates/employee-privacy-notice.md",
        summary="A notice for your mill to issue to its own workers. You are the Personal "
        "Information Controller for their records, so giving this notice is your duty, not ours.",
        # Published so tenants can copy a rendered version with our details
        # already filled in, rather than retyping them. Not part of the
        # agreement they accept: it is theirs to issue, not ours.
        in_bundle=False,
    ),
)

BY_KEY: dict[str, LegalDocument] = {d.key: d for d in DOCUMENTS}
BUNDLE_KEYS: tuple[str, ...] = tuple(d.key for d in DOCUMENTS if d.in_bundle)


def _docs_dir() -> Path:
    """Locate ``legal/``.

    Deployments that ship only the ``backend`` tree can point LEGAL_DOCS_DIR at
    wherever the markdown landed; everything else finds it by walking up.
    """
    override = os.getenv("LEGAL_DOCS_DIR")
    candidates = []
    if override:
        candidates.append(Path(override))
    here = Path(__file__).resolve()
    # backend/app/core/legal.py -> repo root is three levels up.
    candidates.append(here.parents[3] / "legal")
    candidates.append(here.parents[2] / "legal")
    candidates.append(Path.cwd() / "legal")
    for candidate in candidates:
        if (candidate / "entity.json").is_file():
            return candidate
    raise FileNotFoundError(
        "Could not locate the legal/ directory. Set LEGAL_DOCS_DIR to the folder containing entity.json."
    )


@lru_cache(maxsize=1)
def entity() -> dict[str, str]:
    raw = json.loads((_docs_dir() / "entity.json").read_text(encoding="utf-8"))
    return {k: str(v) for k, v in raw.items() if not k.startswith("_")}


def _tokens_for(doc: LegalDocument) -> dict[str, str]:
    return {
        **entity(),
        **doc.extra_tokens,
        "document_title": doc.title,
        "document_version": doc.version,
        "effective_date": doc.effective_date.isoformat(),
    }


@lru_cache(maxsize=len(DOCUMENTS))
def render(key: str) -> str:
    """Return the published text of a document, with tokens substituted.

    An unknown token is left verbatim rather than blanked, so a typo shows up
    in review as ``{{typo}}`` instead of silently deleting a clause.
    """
    doc = BY_KEY[key]
    # read_text() decodes in universal-newline mode, so a CRLF working copy on
    # Windows yields the same string as the LF checkout in the Linux container.
    # content_hash() therefore describes the words and not how the repository
    # happened to be checked out, which matters because acceptance_required()
    # compares a stored hash against the live one and would otherwise read a
    # checkout difference as new terms. Keep this read in text mode.
    source = (_docs_dir() / doc.filename).read_text(encoding="utf-8")
    return substitute(source, _tokens_for(doc))


def substitute(source: str, tokens: dict[str, str]) -> str:
    """Fill each ``{{token}}``: an unknown one stays verbatim, a TODO one reads To follow."""

    def value(m: re.Match[str]) -> str:
        token = m.group(1)
        if token not in tokens:
            return m.group(0)
        return PENDING_MARKER if tokens[token].startswith(_TODO_SENTINEL) else tokens[token]

    return _PLACEHOLDER_RE.sub(value, source)


def content_hash(key: str) -> str:
    return hashlib.sha256(render(key).encode("utf-8")).hexdigest()


def bundle_manifest() -> list[dict[str, str]]:
    """Per-document evidence recorded alongside an acceptance."""
    return [
        {
            "key": k,
            "version": BY_KEY[k].version,
            "effective_date": BY_KEY[k].effective_date.isoformat(),
            "sha256": content_hash(k),
        }
        for k in BUNDLE_KEYS
    ]


def bundle_hash() -> str:
    """One hash covering every document the single acceptance click binds."""
    joined = "\n".join(f"{e['key']}@{e['version']}:{e['sha256']}" for e in bundle_manifest())
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def index() -> list[dict]:
    """Listing for the public /legal page."""
    return [
        {
            "key": d.key,
            "title": d.title,
            "version": d.version,
            "effective_date": d.effective_date.isoformat(),
            "summary": d.summary,
            "in_bundle": d.in_bundle,
        }
        for d in DOCUMENTS
    ]


def unresolved_placeholders() -> list[str]:
    """Human-readable list of everything still unfilled. Empty means shippable.

    Catches both halves of the failure mode: a ``{{token}}`` with no value in
    entity.json, and a value that is still the ``TODO:`` sentinel.
    """
    problems: list[str] = []
    values = entity()
    for doc in DOCUMENTS:
        text = render(doc.key)
        for token in sorted(set(_PLACEHOLDER_RE.findall(text))):
            problems.append(f"{doc.filename}: no value for {{{{{token}}}}}")
        for token in sorted(set(_PLACEHOLDER_RE.findall((_docs_dir() / doc.filename).read_text(encoding="utf-8")))):
            if values.get(token, "").startswith(_TODO_SENTINEL):
                problems.append(f"{doc.filename}: entity.json '{token}' is still a TODO placeholder")
    return sorted(set(problems))
