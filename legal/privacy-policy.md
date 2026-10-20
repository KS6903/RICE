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

Our duties to mills as their Processor are set out in section 9 of the
[Terms of Service](/legal/terms).

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
sell it, and do not use it to train any machine learning or artificial intelligence model. If the
mill's owner switches on the AI advisor, figures and names from these records are sent to DeepSeek to
write the mill's advice, as section 4.2 describes; government identifier numbers, addresses and
telephone numbers never are.

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

### 4.1 Service providers (sub-processors)

These are the third parties that process data for {{product_name}} on our behalf. Each is bound to
process information only on our instructions and to protect it. We give at least 30 days' notice
before adding or replacing a provider that handles personal information, as section 9.5 of the
Terms of Service provides.

**Infrastructure**

| Provider | Purpose | Data it can access | Location |
|---|---|---|---|
| Cloudflare, Inc. | Application hosting, edge network, TLS termination, DDoS and WAF protection | All traffic in transit, including account and Customer Data | Global edge; United States entity |
| {{db_host_provider}} | Managed PostgreSQL database | All account data and Customer Data at rest | {{db_host_region}} |
| {{redis_provider}} | Managed Redis for rate-limit, lockout and cache state | IP addresses, usernames attempted, session identifiers, cached forecasts | {{redis_region}} |
| {{smtp_provider}} | Transactional email delivery | Recipient name and email address, and the contents of verification, reset, security and billing messages | {{smtp_region}} |

**Product features**

| Provider | Purpose | Data it receives | Location |
|---|---|---|---|
| DeepSeek | Generates the Drying Advisor verdict from forecast data | **Weather data only**: coordinates, place name, and forecast values already reduced to a fixed vocabulary of condition labels on our servers. No personal information, no account information, no Customer Data. No chat or free-text path exists. | People's Republic of China |
| DeepSeek | Writes the AI advisor's advice (Enterprise plan; **only while the mill's owner has switched it on**) | Figures computed from the mill's records (purchases, milling, stock, sales, invoices, payments, expenses) and the names of the mill's customers, suppliers and staff. **Never** telephone numbers, addresses, TINs, government identifier numbers, or text users typed into notes, remarks or descriptions. No chat or free-text path exists. | People's Republic of China |
| Open-Meteo | Weather forecast and place-name geocoding | Coordinates or a place-name search string. No personal information. | Germany / European Union |
| Google LLC (Weather API) | Alternative weather forecast source | Coordinates. No personal information. | United States |
| Google LLC (Sign in with Google) | Optional federated sign-in | Authentication exchange only. Google returns the account identifier, email address and name to us; we do not send Google your {{product_name}} data. | United States |
| ipapi.co | Coarse location fallback, used only to pick a default weather location when no coordinates are given | The requesting IP address | United States |
| Have I Been Pwned (Pwned Passwords) | Checks new passwords against known-breached corpora | **The first 5 characters of the SHA-1 hash of the password only**, using the k-anonymity range API. The password, its full hash, and your identity are never sent. | Cloudflare edge |

We do not use advertising networks, third-party analytics or tracking cookies, session-replay
tools, data brokers, or any provider that receives Customer Data for its own purposes.

Weather and the Drying Advisor are built so that **no personal information leaves our systems**.
Forecast conditions are mapped to a closed vocabulary on our servers before any request is made, and
the advisory endpoint accepts no user-supplied free text. This is a design property, not a policy
promise: there is no code path that sends an account record, an employee record or a mill record to
those providers. The AI advisor is the exception, and it is off until a mill's owner switches it on.
Its recipes compute every figure on our servers and send DeepSeek those figures and the names
involved; the queries that gather them never select telephone numbers, addresses, TINs, government
identifier numbers or free text, and an automated test plants each of those in the data and fails if
any reaches the model. The `ipapi.co` fallback is the one feature that sends an IP address
off-platform. It only runs when no coordinates are supplied; if you supply or save a location, it is
not called.

| Date | Change to this list |
|---|---|
| 2026-09-24 | First published, as a separate sub-processor register. |
| {{ai_advisor_effective_date}} | DeepSeek added for the AI advisor: mill figures and names, only for mills whose owner switches it on. Location corrected to the People's Republic of China, as DeepSeek's policy states. |
| {{effective_date}} | Moved into this Privacy Policy. No provider added or removed. |

### 4.2 DeepSeek, the AI language model provider, and cross-border processing

Two features use automated language models operated by DeepSeek, whose processing takes place in the
People's Republic of China.

**The Drying Advisor** sends only weather data: coordinates, place name, and forecast values already
reduced to a fixed set of condition labels on our own servers. No personal information, no account
information, and no mill records are sent.

**The AI advisor** (Enterprise plan only) is off until the mill's owner switches it on, and the owner
can switch it off at any time. While it is on, its recipes send DeepSeek figures computed from the
mill's records (purchases, milling, stock, sales, invoices, payments and expenses) together with the
names of the mill's customers, suppliers and staff, so that it can write advice for the mill. **They
never send** telephone numbers, addresses, tax identification numbers, government identifier numbers,
or anything a user typed into a note, remark or description. Neither feature has a chat or free-text
path: you cannot send your own text to the model.

DeepSeek's own privacy policy says it may keep what it receives for as long as the account that sent
it exists, and may use it to improve its models unless the account holder opts out.
{{deepseek_training_optout}}

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
| Mill records (as Processor) | Per the mill's instruction; on termination, per section 17.4 of the Terms of Service |
| Security and audit logs | Up to 24 months, then deleted or anonymised |
| Sign-in and session records | Up to 12 months |
| Billing and tax records | 10 years, as Philippine tax and accounting rules require |
| Encrypted backups | Expire on their normal rotation cycle, within 90 days |
| Support correspondence | 24 months from the last message |

## 6. How we protect it

We maintain organisational, physical and technical measures appropriate to the risk. They currently
include:

**Organisational**

- A designated Data Protection Officer and a documented incident response procedure.
- Access on a need-to-know basis, reviewed periodically; separate credentials per environment.
- Confidentiality undertakings from personnel and from sub-processors.
- Change control through version-controlled code, code review and automated security checks in the
  build pipeline.
- Fail-closed production configuration: the service refuses to start if a required security setting
  is missing, default or weak.

**Technical**

- Transport encryption (TLS) for all traffic, HTTP Strict Transport Security in production, and a
  restrictive set of security headers.
- Passwords stored as salted hashes; new and changed passwords checked against known-breached
  password lists using a privacy-preserving range query.
- Multi-factor authentication, enforced for privileged roles, with encrypted seeds, single-use codes
  and hashed recovery codes.
- Short-lived session tokens in HTTP-only cookies, CSRF protection on state-changing requests,
  server-side session revocation, and rate limiting and lockout on authentication endpoints.
- Each mill's operational data is held in its own database schema, so one customer's queries cannot
  reach another customer's tables.
- The application connects with a least-privilege database role that cannot alter database
  structure. Schema changes and tenant provisioning use a separate credential held by a separate
  process.
- Role-based access control, so a cashier or encoder sees only what their role needs.
- An append-only activity log of notable actions, with the actor, time and affected record, and
  automated auditing of state-changing requests.
- Encrypted backups, with restores tested.
- Full-disk encryption required on any device holding an offline copy of customer data.

**Physical**

- Hosting in the facilities of the infrastructure providers listed in section 4.1, each operating
  under recognised security certifications.

We may change these measures, provided the overall level of protection is not reduced. No system is
perfectly secure. We do not guarantee absolute security, and section 13 of the Terms of Service
applies.

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
