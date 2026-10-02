# Liability exposure review

A review of where Oryza could realistically be sued, what has been built in response, and what is
still open. Written 2026-09-24 against branch `feat/schema-per-client`.

**Not legal advice, and not written by a lawyer.** It is an engineer's map of the risk surface, so
that counsel's time is spent on judgement rather than discovery. Nothing here substitutes for a
Philippine lawyer reviewing the documents in this folder before commercial launch.

"Sue-proof" is not achievable. Anyone can file. What is achievable is: reducing the number of things
worth suing over, capping what a successful claim is worth, putting each duty on the party who can
actually discharge it, and being able to prove what happened. That is what this work does.

---

## The starting position

Before this change the product had strong security engineering and **zero legal surface**: no Terms
of Service, no Privacy Policy, no data processing agreement, no acceptance record, no disclaimers on
any output. A multi-tenant SaaS holding Philippine workers' SSS, PhilHealth, Pag-IBIG and TIN
numbers, giving AI-generated operational advice about stock worth real money, and producing
documents it calls "invoices", had nothing standing between it and an unbounded claim.

## Ranked exposure

### 1. Sensitive personal information without a privacy framework — **criminal, not just civil**

`Employee` holds `sss_no`, `philhealth_no`, `pagibig_no`, `tin`, `birthdate`, `address` and
`monthly_salary`. Under RA 10173 §3(l), government-issued identifiers are **sensitive personal
information**. Unauthorised or negligent processing of SPI carries imprisonment and fines up to
₱4,000,000 under §§25 to 32, and §34 makes responsible officers personally liable. This is the only
exposure in the system that can reach a person rather than a balance sheet.

**Built:** Privacy Policy stating the two roles (Controller for accounts, Processor for mill
records); a Data Processing Addendum that is the written outsourcing contract §21 requires; an
employee privacy notice template that puts the notice duty on the mill, which is the actual
Controller; a point-of-use notice on the Government IDs section of the employee form.

**Still open:** field-level encryption for the four identifier columns; access logging when they
are read; masking them in the UI by default. See *Remaining work*.

### 2. No contract at all

With no Terms, every default applies: no liability cap, no warranty disclaimer, no venue, no
limitation period, and no answer to a customer who says the software lost them a harvest.

**Built:** a Terms of Service with an as-is warranty disclaimer (§11), an excluded-loss list written
against this specific business (§12.1: spoilage, moisture damage, quality downgrade, lost drying
window, regulatory fines, claims by the customer's own workers and farmers), a cap at the greater of
12 months' fees or ₱50,000 (§12.2), a ₱50,000 flat cap for free and beta use (§12.3), a 12-month
limitation period (§12.6), a customer indemnity (§13), Philippine governing law and a single venue
(§17).

The carve-out in §12.4 is load-bearing. Articles 1170 and 2201 of the Civil Code do not permit
waiving liability for fraud, bad faith or gross negligence, and a clause that tries to is at risk of
being struck down in full. Excluding those explicitly is what keeps the rest of §12 standing.

### 3. No record that anyone ever agreed

A Terms of Service nobody can be shown to have accepted is close to worthless.

**Built:** the `legal_acceptances` ledger. Every acceptance stores the bundle version, the SHA-256 of
each document as rendered on screen, the method, the time, the IP and the user agent. Written in the
same transaction as the user record at signup, so no account can exist without one. The runtime
database role cannot `UPDATE` or `DELETE` the table. The server re-validates the consent flag and
version rather than trusting the client, and a stale browser tab holding superseded terms is
rejected instead of silently binding the user to text they never saw.

### 4. AI operational advice with no disclaimer

The Drying Advisor tells a mill operator whether to spread wet palay on pavement. A wrong "good"
before an afternoon shower ruins a batch. Damages are concrete, foreseeable and easy to quantify,
which is exactly the profile of a claim that gets filed.

**Built:** §5.4 of the Terms; a disclaimer permanently visible with the verdict in the compact card,
not hidden behind the hover; a fuller disclaimer in the popover linking to the Terms; §5.1 and §5.2
of the Acceptable Use Policy forbidding customers from presenting the output as certified or from
building safety-critical controls on it.

The pre-existing design helps here more than any wording: no user free text reaches the model, the
prompt is bounded, and the input is our own forecast vocabulary. That is a real defence against both
prompt injection and a claim that the model was fed something misleading.

### 5. BIR exposure through the word "invoice"

`Invoice`, `invoice_no`, `Payment`, and reports typed `NFA_monthly` and `DA_quarterly` all imply
records of a kind Philippine tax law regulates. Oryza is not a BIR-accredited Computerized
Accounting System, and a customer who treats its output as registered books is heading for an
assessment they will look for someone to blame for.

**Built:** §5.2 and §5.3 of the Terms; a permanent notice on the invoices tab and on the reports
page; §1.2 and §1.4 of the Acceptable Use Policy.

**Still open:** the strongest version of this fix is product, not wording. Renaming the entity to
"Sales record" in the UI, and adding a visible "not an Official Receipt" line to any printed or
exported invoice, removes the misunderstanding rather than disclaiming it.

### 6. Undisclosed cross-border transfers

Traffic leaves the Philippines to DeepSeek, Google, Open-Meteo, ipapi.co and Cloudflare. None of it
was disclosed. §21 of the Data Privacy Act keeps a Controller accountable for information
transferred to a third party.

**Built:** a sub-processor register naming each provider, what it receives and where; §4.2 of the
Privacy Policy and §7 of the DPA. The register makes the real point: **no personal information
reaches DeepSeek or the weather providers.** Forecast conditions are reduced to a closed vocabulary
on our own servers first. That is verifiable in
[`drying_advisor_service.py`](../backend/app/services/drying_advisor_service.py), and a property of
the code is worth considerably more than a promise in a policy.

`ipapi.co` is the exception: it receives an IP address, and only when no coordinates are supplied.
It is disclosed as such.

**Changed (October 2026): the AI advisor.** Enterprise mills can now have DeepSeek write advice from
their own figures, and that sends personal information abroad: the names of customers, suppliers and
staff, with sales and purchase figures, to the People's Republic of China. Still open, for counsel:

- **Consent and lawful basis.** It is off until the mill's owner switches it on, after a plain
  disclosure; the switch records who and when. The mill is the Controller for its customers' and
  workers' names, so the question is whether the mill's own notices to those people cover this
  transfer. The employee privacy notice template may need a line on it.
- **DeepSeek's terms.** Its privacy policy (10 February 2026) says it stores data in the PRC, keeps
  inputs for as long as the account exists, and may use them to train its models unless the account
  holder opts out. The documents carry a `deepseek_training_optout` TODO, which blocks the production
  gate until the opt-out is done and the sentence filled in.
- **Minimisation, as code.** No phone numbers, addresses, TINs, government IDs or user free text are
  selected for these prompts. `test_every_ai_recipe_runs_and_sends_nothing_private` plants each of
  them and fails if any reaches the model.

### 7. Tenant isolation

A cross-tenant data leak is the single most reliable way for a B2B SaaS to be sued by every customer
at once.

**Nothing needed.** Schema-per-tenant, a DML-only runtime database role that cannot run DDL, a
separate provisioner credential in a separate process, and a fail-closed production config validator
were already in place. §5 of the DPA documents them, which is what turns existing engineering into a
contractual position.

---

## What was built

**Documents** (`legal/`): Terms of Service, Privacy Policy, Data Processing Addendum, Acceptable Use
Policy, sub-processor register, and an employee privacy notice template for tenants to issue. All
render from one `entity.json`, so each company fact is filled in once.

**Backend**
- `app/core/legal.py` — versioned registry, token substitution, per-document and bundle SHA-256,
  and `unresolved_placeholders()`.
- `app/models/legal.py`, `app/services/legal_service.py`, `app/api/legal.py` — the acceptance
  ledger and the public document API.
- `migrations/versions/006_legal_acceptance_ledger.py` — the table, plus a `REVOKE UPDATE, DELETE`
  from the runtime role.
- Signup (password and Google) now requires and records acceptance server-side; `/auth/me` reports
  `legal_acceptance_required`.
- The `ENV=prod` config validator refuses to boot while any placeholder is unfilled. A Terms of
  Service naming no legal entity and no venue is worse than none, because it invites the argument
  that no agreement was formed.

**Frontend**
- Public `/legal` and `/legal/:key` pages, reachable without a session and from every gate, with the
  document's sha256 published so a customer can verify what they agreed to.
- A dependency-free Markdown renderer that never uses `dangerouslySetInnerHTML`.
- A consent checkbox on signup, and a blocking re-acceptance gate when the bundle version moves.
- `LegalNotice` disclaimers on reports, invoices, employee government IDs, and the Drying Advisor.

---

## Remaining work

Ordered by how much exposure each removes.

### Must do before charging money

1. **Fill in `entity.json`.** 22 values are still `TODO`. Production will not boot until they are
   filled.
2. **Have a Philippine lawyer review every document.** Particularly §12 of the Terms, because the
   enforceability of a liability cap is a judgement call about Civil Code Articles 1170, 1173 and
   2201 that this review cannot make.
3. **Appoint a Data Protection Officer and decide on NPC registration.** Registration is generally
   required when processing sensitive personal information of 1,000 or more individuals. Count
   across all tenants, since we are the Processor for all of them. The Privacy Policy already has a
   field for the registration number.
4. **Get professional indemnity / technology errors and omissions insurance.** A liability cap
   limits what a court can award. Insurance covers the cost of defending the claim, which is
   usually the larger number.

### Engineering, high value

5. **Encrypt the four government identifier columns at rest.** `app/core/crypto.py` already does
   Fernet encryption for MFA seeds, so the pattern exists. This converts a database compromise from
   an SPI breach into a much smaller incident.
6. **Log reads of employee SPI, and mask it in the UI by default** behind a "reveal" action. Both
   deter internal misuse and give an audit trail if it happens anyway.
7. **Data subject request endpoints**: export and deletion, per §16 of the Data Privacy Act and §9
   of the DPA. The DPA commits to a 30-day export window; today that would be a manual database
   job.
8. **Rename "invoice" in the UI** to "Sales record", and print a "not an Official Receipt" line on
   any exported or printed document. Removing the misunderstanding beats disclaiming it.
9. **A written incident response runbook** with the 24-hour processor-to-controller and 72-hour
   NPC clocks that the DPA and Privacy Policy now commit to. Committing to a deadline without a
   procedure to meet it creates a breach of contract on top of the breach.
10. **Retention enforcement.** The Privacy Policy publishes a retention table; nothing currently
    deletes anything on that schedule. A published retention period that is not honoured is worse
    than none.

### Process

11. **Extend the acceptance gate to invited users.** Today an owner accepts for the company at
    signup, and an Authorised User added later is caught by the re-acceptance gate only when the
    bundle version moves. They should accept on first sign-in.
12. **Tell the `mill1`-`mill8` testers** they are on a beta covered by §4 and the ₱50,000 cap in
    §12.3. A tester who was never told they were testing is a plaintiff with a story.
13. **Seed and verify the flow on `mill1`-`mill3` first**, per the project's tiering rule, before
    exposing it to `mill4`-`mill8`.
