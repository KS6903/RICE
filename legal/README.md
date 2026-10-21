# legal/

The published agreements for Oraiza, and the machinery that serves them.

**None of this is legal advice, and none of it was written by a lawyer.** These are drafts built
from the actual behaviour of this codebase, so that a Philippine lawyer can review something
concrete and cheap rather than start from a blank page. Do not launch commercially until counsel
has reviewed them. See [EXPOSURE_REVIEW.md](EXPOSURE_REVIEW.md) for what they are protecting
against and what is still open.

## Before you ship

1. Open [entity.json](entity.json) and replace every `TODO:` value. That file is the single source
   of truth; every document renders from it, so you fill each fact in once.
2. Run the check:
   ```powershell
   cd backend
   .\.venv\Scripts\python.exe -c "from app.core.legal import unresolved_placeholders; print('\n'.join(unresolved_placeholders()) or 'all filled in')"
   ```
   An empty result means shippable. The same check runs in
   `backend/tests/unit/test_legal_documents.py` and inside the `ENV=prod` config validator, so a
   production API refuses to boot while a placeholder remains.
3. Have counsel review, and apply their edits to the markdown.
4. Point your tenants at the employee privacy notice, which the app serves at
   `/legal/employee-notice` with your details already substituted.
   Their workers' government ID numbers are the sharpest liability in the system, and that notice
   is what puts the duty where it belongs.

## The documents

Two documents, the way Google publishes its own: the Terms and the Privacy Policy.

| File | Key | In the acceptance bundle |
|---|---|---|
| `terms-of-service.md` | `terms` | yes |
| `privacy-policy.md` | `privacy` | yes |
| `templates/employee-privacy-notice.md` | `employee-notice` | no, it is for tenants to issue to their own workers, and it isn't listed on `/legal`: section 9.3 of the Terms links to it |

What used to be separate documents are sections now: the Data Processing Addendum is section 9 of
the Terms, the Acceptable Use Policy is section 7, and the sub-processor register is section 4.1 of
the Privacy Policy. The old `/legal/dpa`, `/legal/aup` and `/legal/subprocessors` links scroll to
those sections.

## How versioning works

Each document has a version and an effective date in
[`backend/app/core/legal.py`](../backend/app/core/legal.py). The two documents a customer accepts
in one click form the **agreement bundle**, versioned by `AGREEMENT_VERSION`.

Editing a document changes its content hash, which changes the bundle hash, which makes
`acceptance_required` true for every user whose stored hash no longer matches. They see a blocking
re-acceptance screen the next time they load the app.

That is intentional but not free: it interrupts every tenant. So:

- **Typo or formatting fix**: edit the markdown, leave the versions alone. Existing users are still
  pushed to re-accept, because the hash moved. If that is not what you want, batch the fix with the
  next real change.
- **Material change** (a new clause, a changed liability cap, a new purpose for personal data): bump
  the document's `version`, bump `AGREEMENT_VERSION`, set a new `effective_date` at least 30 days
  out (`terms_change_notice_days`), and notify account administrators before that date. Section 20
  of the Terms promises this.
- **A new sub-processor**: notify administrators 30 days ahead (section 9.5 of the Terms), then add
  it to section 4.1 of the Privacy Policy and its change log. That edit moves the bundle hash, so
  every tenant re-accepts once; the list lives inside the Privacy Policy now, not beside it.

## How acceptance is recorded

`legal_acceptances` (public schema, migration `006_legal_acceptance`) stores one row per click:
the user, the company they acted for, the bundle version, the bundle hash, a per-document manifest
of key/version/effective date/sha256, the method, the IP and the user agent.

The row is written inside the same transaction as the user record at signup, so an account cannot
exist without the acceptance that created it. The runtime database role has `INSERT` and `SELECT`
but not `UPDATE` or `DELETE` on that table, so a compromised application credential cannot rewrite
the evidence.

Publishing the sha256 on each document page is deliberate: a customer can confirm that what they
are reading is what they agreed to, and so can you.

## Adding a document

1. Write the markdown here, using `{{token}}` for anything from `entity.json`.
2. Add a `LegalDocument` entry to `DOCUMENTS` in `backend/app/core/legal.py`.
3. Decide `in_bundle` and `listed`. If it is in the bundle, bump `AGREEMENT_VERSION` and expect
   every tenant to re-accept. Prefer a new section of the Terms or the Privacy Policy over a new
   document: two documents is the point.
4. If it belongs in the bundle, name it in `LegalAcceptanceGate.tsx` and the signup checkbox.
5. Run `pytest tests/unit/test_legal_documents.py`.
