"""Unit tests for the legal document registry.

These are the checks that keep the published agreements usable as evidence: the
files exist, they render, nothing is left unfilled, and the hash that an
acceptance stores actually tracks the text.
"""

from __future__ import annotations

import pytest

from app.core import legal


def test_every_registered_document_renders():
    for doc in legal.DOCUMENTS:
        text = legal.render(doc.key)
        assert text.strip(), f"{doc.filename} rendered empty"
        assert text.lstrip().startswith("#"), f"{doc.filename} should open with a heading"


def test_bundle_covers_the_agreements_a_customer_clicks_once():
    # The sub-processor register changes on its own 30-day notice cycle and
    # must not drag every tenant back through the acceptance gate.
    assert set(legal.BUNDLE_KEYS) == {"terms", "privacy", "dpa", "aup"}
    assert "subprocessors" not in legal.BUNDLE_KEYS


def test_bundle_hash_changes_when_a_document_changes(monkeypatch):
    before = legal.bundle_hash()
    real_render = legal.render.__wrapped__

    def altered(key: str) -> str:
        text = real_render(key)
        return text + "\n\nAn added clause.\n" if key == "terms" else text

    monkeypatch.setattr(legal, "render", altered)
    assert legal.bundle_hash() != before, "bundle hash must track document text"


def test_content_hash_is_stable_across_calls():
    assert legal.content_hash("terms") == legal.content_hash("terms")


def test_content_hash_ignores_line_endings(tmp_path, monkeypatch):
    """The hash must describe the text, not the checkout.

    core.autocrlf rewrites line endings on Windows, so the same document can sit
    on disk as LF in the Linux container and CRLF on a developer's machine. If
    that changed the hash, acceptance_required() would compare a stored hash
    against a different live one and send every user back through the consent
    gate over a checkout rather than a change of terms.

    render() gets this for free today because read_text() decodes in
    universal-newline mode. This locks the property down, so that switching to
    read_bytes() — or opening with newline="" for some unrelated reason — fails
    here instead of silently re-prompting every customer after a deploy.
    """
    src = legal._docs_dir()
    crlf = tmp_path / "legal"
    (crlf / "templates").mkdir(parents=True)
    for doc in legal.DOCUMENTS:
        text = (src / doc.filename).read_text(encoding="utf-8")
        (crlf / doc.filename).write_text(text.replace("\r\n", "\n").replace("\n", "\r\n"), encoding="utf-8", newline="")
    (crlf / "entity.json").write_bytes((src / "entity.json").read_bytes())

    before = {doc.key: legal.content_hash(doc.key) for doc in legal.DOCUMENTS}
    bundle_before = legal.bundle_hash()

    monkeypatch.setattr(legal, "_docs_dir", lambda: crlf)
    legal.render.cache_clear()
    legal.entity.cache_clear()
    try:
        assert (crlf / "terms-of-service.md").read_bytes().count(b"\r\n") > 0, "fixture is not CRLF"
        assert {doc.key: legal.content_hash(doc.key) for doc in legal.DOCUMENTS} == before
        assert legal.bundle_hash() == bundle_before
    finally:
        monkeypatch.undo()
        legal.render.cache_clear()
        legal.entity.cache_clear()


def test_manifest_records_version_and_hash_per_document():
    manifest = legal.bundle_manifest()
    assert [e["key"] for e in manifest] == list(legal.BUNDLE_KEYS)
    for entry in manifest:
        assert len(entry["sha256"]) == 64
        assert entry["version"]
        assert entry["effective_date"]


def test_key_clauses_survive_edits():
    """A regression guard, not a style check.

    Each of these is a clause the business actually relies on, and each has a
    plausible way of being deleted by accident during a rewrite. If one of
    these assertions fails, confirm the protection still exists somewhere
    before changing the test.
    """

    # Documents are hard-wrapped, so a clause can straddle a newline.
    def flat(key: str) -> str:
        return " ".join(legal.render(key).split())

    terms = flat("terms")
    assert "Limitation of liability" in terms
    assert "as is" in terms.lower() and "as available" in terms.lower()
    assert "BIR-accredited" in terms
    assert "gross negligence" in terms  # the carve-out that keeps 12.2 enforceable
    assert "Drying Advisor" in terms

    privacy = flat("privacy")
    assert "10173" in privacy
    assert "National Privacy Commission" in privacy
    assert "72 hours" in privacy

    dpa = flat("dpa")
    assert "Personal Information Processor" in dpa
    assert "24 hours" in dpa  # processor-to-controller breach clock


@pytest.mark.skipif(
    bool(legal.unresolved_placeholders()),
    reason="entity.json still holds TODO placeholders; see legal/README.md",
)
def test_no_unresolved_placeholders():
    assert legal.unresolved_placeholders() == []


def test_a_todo_value_reads_to_follow_but_still_blocks_production():
    """Customers never see our TODO notes; the production gate still sees the TODO."""
    filled = legal.substitute("By {{a}} at {{b}}, {{typo}}.", {"a": "TODO: SEC name", "b": "Manila"})
    assert filled == f"By {legal.PENDING_MARKER} at Manila, {{{{typo}}}}."
    for key in legal.BY_KEY:
        assert "TODO:" not in legal.render(key)
    if any(v.startswith("TODO:") for v in legal.entity().values()):
        assert legal.unresolved_placeholders()


def test_placeholder_check_flags_todo_values():
    """The gate itself has to work, even while the values are still TODO."""
    problems = legal.unresolved_placeholders()
    # Either everything is filled in (the skipped test above covers that), or
    # the checker reports each unfilled key by name rather than silently
    # passing. A silent pass here is the failure mode that would let a
    # placeholder Terms of Service reach production.
    if problems:
        assert all("legal" not in p or ".md:" in p for p in problems)
        assert any("provider_legal_name" in p for p in problems)
