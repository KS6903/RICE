# Privacy Policy

{{provider_legal_name}}, trading as {{provider_name}}, operates {{product_name}}. This notice
explains how we handle personal information, and is issued under Republic Act No. 10173, the Data
Privacy Act of 2012, its Implementing Rules and Regulations, and the issuances of the National
Privacy Commission (NPC).

## 1. Two different roles

Read this first, because your rights and our duties depend on which role applies.

**We are the Personal Information Controller** for the accounts of the people who sign in to
{{product_name}}: the mill owner, accountant, cashier, encoder, mill operator and field operator
who hold login credentials, plus anyone who contacts our support. We decide how that information is
handled.

**We are a Personal Information Processor** for everything a mill records inside its own workspace:
employee records, supplier and farmer records, customer records, driver and contact details.
**The mill is the Personal Information Controller** for that information. We only process it on the
mill's documented instructions. If you are an employee, supplier, farmer or customer of a mill and
you want to see, correct or delete your information, contact that mill first. We will help them
respond, but we cannot act on that information without their instruction, except where law requires
us to.

Our processing duties to mills are set out in the [Data Processing Addendum](/legal/dpa).

## 2. What we collect

### 2.1 Account and identity information (we are Controller)

- Name, username, email address, role, and the company and branch you belong to.
- Password, stored only as a salted hash. We never store it in readable form.
- Multi-factor authentication secrets, encrypted at rest, and the backup codes you generate, stored
  as hashes.
- If you sign in with Google: the Google account identifier, email address and name that Google
  returns. We do not receive your Google password.
- Email verification and password reset tokens, stored as hashes with an expiry.

### 2.2 Usage, device and security information (we are Controller)

- Sign-in times, session identifiers, and the device and browser type you used.
- IP address, and the approximate country or region it indicates.
- Records of security-relevant actions: sign-in attempts, multi-factor events, password changes,
  session revocations, and changes to warehouses and other records that our activity log covers.
- Application error and performance logs.

We keep this to secure accounts, detect abuse, meet our own legal duties, and prove what happened
if a dispute or incident arises. Our lawful basis is our legitimate interest in keeping the service
secure, and compliance with legal obligation, under sections 12(d) and 12(f) of the Data Privacy
Act.

### 2.3 Location (we are Controller of your choice, not of your movement)

If you use the weather or drying features, the app may ask for your device location, or you may
save a mill location by hand. We use the coordinates only to fetch a forecast for that place, and
we store saved locations so you do not have to re-enter them. We do not track your movement, keep a
location history, or build a profile from location. You can decline the browser prompt and enter a
location manually, or not use the feature at all.

### 2.4 Mill records (we are Processor; the mill is Controller)

Information mills enter about other people. This can include **Sensitive Personal Information** as
the Data Privacy Act defines it, in particular:

- government identifier numbers: SSS, PhilHealth, Pag-IBIG and TIN;
- birthdate and age;
- home address, personal telephone number, emergency contact;
- salary and employment details.

We hold this only to run the service for the mill. We do not use it for our own purposes, do not
sell it, and do not use it to train any machine learning or artificial intelligence model.

### 2.5 Billing information

Plan, subscription status, invoices and payment status. If and when card or e-wallet payments are
added, the payment details are handled by the payment provider, not stored by us.

## 3. What we do with it

- Provide, operate and support {{product_name}}.
- Authenticate you and protect your account.
- Detect, investigate and prevent fraud, abuse and security incidents.
- Send service messages: verification, password reset, security alerts, billing notices, and notice
  of changes to these documents.
- Meet legal, tax and regulatory obligations.
- Understand aggregate usage so we can improve the product. Where we publish or analyse usage we do
  so in aggregated or de-identified form that does not identify any person.

We do **not** sell personal information, rent it, share it for anyone else's marketing, use it for
automated decisions with legal or similarly significant effects, or use mill records to train AI
models.

## 4. Who we share it with

### 4.1 Sub-processors

We use the service providers listed in the [Sub-processor register](/legal/subprocessors). Each is
bound to process information only on our instructions and to protect it. The register names each
provider, what it receives, why, and where it processes.

### 4.2 The Drying Advisor and cross-border processing

The Drying Advisor sends data to an automated language model operated by DeepSeek, whose processing
takes place outside the Philippines. **We send only weather data: coordinates, place name, and
forecast values already reduced to a fixed set of condition labels on our own servers.** No
personal information, no account information, and no mill records are sent. There is no chat, no
free-text field, and no way for you to send your own text to the model through this feature.

Some of our other providers also process outside the Philippines, including in the United States and
the European Union. Where information crosses a border we remain accountable for it under section 21
of the Data Privacy Act, and we require contractual protections at least equivalent to this notice.

### 4.3 Others

- **Your own organisation.** Owners and administrators of your mill can see your account details,
  your role and your activity in the activity log.
- **Professional advisers**, such as auditors and lawyers, under a duty of confidence.
- **Authorities**, where a valid subpoena, warrant, order or legal obligation requires it. We check
  that a request is lawful and specific, disclose only what it actually requires, and tell the
  affected party unless the law forbids us.
- **A successor**, in a merger, acquisition or sale of assets. We will give notice before your
  information becomes subject to a different privacy notice.

## 5. How long we keep it

| Information | Retention |
|---|---|
| Account records | For the life of the account, then {{data_deletion_days}} days |
| Mill records (as Processor) | Per the mill's instruction; on termination, per the Data Processing Addendum |
| Security and audit logs | Up to 24 months, then deleted or anonymised |
| Sign-in and session records | Up to 12 months |
| Billing and tax records | 10 years, as Philippine tax and accounting rules require |
| Encrypted backups | Expire on their normal rotation cycle, within 90 days |
| Support correspondence | 24 months from the last message |

## 6. How we protect it

- Transport encryption (TLS) for all traffic, and HTTP Strict Transport Security in production.
- Passwords hashed, multi-factor secrets encrypted at rest, and enforced multi-factor
  authentication for privileged roles.
- Each mill's operational data is held in its own database schema, isolating tenants from one
  another.
- The application connects with a least-privilege database role that cannot alter database
  structure. Schema changes use a separate credential held by a separate process.
- Role-based access control, so a cashier or encoder sees only what their role needs.
- Fail-closed production configuration: the service refuses to start if a required security setting
  is missing or weak.
- Security headers, CSRF protection, rate limiting on authentication endpoints, and a check of new
  passwords against known-breached password lists.
- An append-only activity log of notable actions.
- Encrypted backups, with restores tested.

No system is perfectly secure. We do not guarantee absolute security, and section 11 of the Terms
of Service applies.

## 7. Your rights

Under sections 16 and 18 of the Data Privacy Act you have the right to:

- **be informed** that your personal information is or will be processed;
- **object** to processing, including for marketing or profiling;
- **access** your personal information and the details of how it is processed;
- **correct** information that is inaccurate or out of date;
- **erase or block** information that is unlawfully obtained, no longer necessary, incomplete,
  outdated, false, or used for a purpose you did not authorise;
- **damages**, where you suffer because of inaccurate, incomplete, outdated, false, unlawfully
  obtained or unauthorised use of your information;
- **data portability**, to obtain a copy in a structured, commonly used, electronic format; and
- **lodge a complaint** with the National Privacy Commission.

Your rights over a deceased or incapacitated person's information may be exercised by their lawful
heirs or assigns.

### How to exercise them

Write to our Data Protection Officer at {{dpo_email}}. We will acknowledge within 5 working days
and respond substantively within 15 calendar days, or tell you why we need longer. We may ask you to
verify your identity before we act, so that we do not disclose your information to someone else.

If your request concerns records a mill holds about you, we will forward it to that mill, because
they control it. Contact them directly for the fastest result.

## 8. If there is a data breach

If a personal data breach occurs that meets the notification criteria in section 20(f) of the Data
Privacy Act and NPC Circular 16-03, we will notify the National Privacy Commission and the affected
data subjects within 72 hours of knowledge of the breach. Where we are a Processor, we will notify
the affected mill without undue delay and in any event within 24 hours of knowledge, so that the
mill can meet its own 72-hour deadline. We maintain a breach record and an incident response
procedure.

## 9. Cookies and similar technologies

We use only strictly necessary cookies:

| Cookie | Purpose |
|---|---|
| Session cookie | Keeps you signed in. HTTP-only, so scripts cannot read it. |
| Refresh cookie | Renews your session without making you sign in again. HTTP-only. |
| CSRF token | Protects against cross-site request forgery. Readable by the app by design. |

We do not use advertising, tracking or analytics cookies, and we do not embed third-party
advertising trackers. Blocking these cookies will stop you from signing in.

## 10. Children

{{product_name}} is a business tool and is not directed at children. We do not knowingly collect
information from anyone under 18 for an account. Mills must not enter records of workers under the
legal minimum working age, and remain responsible for compliance with child labour law.

## 11. Changes to this notice

We may update this notice. Each version has a version number and an effective date. For material
changes we will give at least {{terms_change_notice_days}} days' notice by email or in-app notice,
and ask you to acknowledge it when you next sign in. We keep a record of which version each account
acknowledged and when.

## 12. Contact and complaints

**Data Protection Officer**

{{dpo_name}}

{{dpo_email}}

{{dpo_phone}}

{{provider_legal_name}}, {{provider_address}}

NPC registration: {{npc_registration}}

If you are not satisfied with our response, you may complain to:

**National Privacy Commission**

5th Floor, Delegation Building, PICC Complex, Roxas Boulevard, Pasay City 1307, Metro Manila

complaints@privacy.gov.ph  ·  privacy.gov.ph
