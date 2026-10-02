# Data Processing Addendum

This Addendum forms part of the [Terms of Service](/legal/terms) between {{provider_legal_name}}
("Processor", "we") and the Customer ("Controller", "you"). It is the written outsourcing contract
required by section 21 of Republic Act No. 10173 (the Data Privacy Act of 2012), Rule X of its
Implementing Rules and Regulations, and NPC Circular 16-01 and 16-03.

Where this Addendum conflicts with the Terms of Service on the handling of personal information,
this Addendum prevails.

## 1. Roles

1.1 You are the **Personal Information Controller** for all personal information in your Customer
Data. You decide what is collected, why, and for how long.

1.2 We are the **Personal Information Processor**. We process that information only to provide the
Service, and only on your documented instructions.

1.3 Your use of the Service, together with the Terms of Service and any written instruction you
give us through support channels, constitutes your documented instructions. If we believe an
instruction breaches the Data Privacy Act, we will tell you and may decline to act on it.

1.4 We remain the **Personal Information Controller** for account, authentication, security and
billing information about your Authorised Users, as described in the
[Privacy Policy](/legal/privacy).

## 2. Scope of processing

**Subject matter.** Provision of the {{product_name}} rice mill management service.

**Duration.** For as long as your account is active, plus the retention periods in section 9.

**Nature and purpose.** Storage, structuring, retrieval, display, computation, reporting, backup,
transmission between your devices and our servers, and deletion, all in order to run the Service.

**Categories of data subject.** Your employees and workers; your Authorised Users; farmers,
suppliers and their representatives; customers and their representatives; drivers and fleet
personnel; emergency contacts.

**Categories of personal information.**

- Identity and contact: name, address, telephone number, email address, photograph if uploaded.
- Employment: position, branch, hire date, employment status, salary, attendance and payroll data.
- Commercial: supplier and customer records, transaction history, balances, credit terms.
- Operational: entries attributed to a named user, recorded times and locations of operations.

**Categories of Sensitive Personal Information.** Government identifier numbers (SSS, PhilHealth,
Pag-IBIG, TIN), birthdate and age, and marital or family details if you enter them. You should not
enter health, racial or ethnic origin, religious or political affiliation, or information about
offences, because the Service is not designed to hold them.

## 3. Your obligations as Controller

3.1 You warrant that you have a lawful basis under sections 12 and 13 of the Data Privacy Act for
every item of personal information you put into the Service. For employee records this will usually
be section 12(a) or 12(b) and, for Sensitive Personal Information, section 13(b), which permits
processing necessary to comply with existing laws and regulations governing employment, social
security, health insurance and taxation.

3.2 You warrant that you have given your data subjects the privacy notice the law requires. A
notice you can adapt is provided at [templates/employee-privacy-notice.md](templates/employee-privacy-notice.md).

3.3 You are responsible for the accuracy, quality and legality of your Customer Data, and for
deciding who in your organisation may see it. Configure roles and branch access accordingly.

3.4 You will not enter personal information that the Service does not ask for, and you will not use
free-text fields to store Sensitive Personal Information.

3.5 If you process the personal information of 1,000 or more individuals, or process Sensitive
Personal Information of 1,000 or more individuals, you may be required to register your data
processing systems with the National Privacy Commission and to designate your own Data Protection
Officer. That obligation is yours, not ours.

## 4. Our obligations as Processor

We will:

4.1 process personal information only on your documented instructions, including for any transfer
outside the Philippines, unless a law we are subject to requires otherwise, in which case we will
tell you first unless that law forbids it;

4.2 ensure that every person we authorise to process personal information is bound by an obligation
of confidentiality that survives the end of their engagement, and is trained on their duties;

4.3 implement and maintain the security measures in section 5;

4.4 assist you, by appropriate technical and organisational measures and taking account of the
nature of processing, to respond to requests from data subjects exercising their rights;

4.5 assist you with security, breach notification, privacy impact assessments and consultation with
the National Privacy Commission, taking account of the information available to us;

4.6 at your choice, delete or return personal information at the end of the Service, as section 9
provides;

4.7 make available the information reasonably necessary to demonstrate compliance with this
Addendum, and allow and contribute to audits as section 8 provides;

4.8 not use your Customer Data for our own purposes, not disclose it except as this Addendum
permits, and **not use it to develop, train, fine-tune or evaluate any machine learning or
artificial intelligence model**.

## 5. Security measures

We maintain organisational, physical and technical measures appropriate to the risk, which
currently include:

**Organisational**

- A designated Data Protection Officer and a documented incident response procedure.
- Access on a need-to-know basis, reviewed periodically; separate credentials per environment.
- Confidentiality undertakings from personnel and from sub-processors.
- Change control through version-controlled code, code review and automated security checks in the
  build pipeline.
- A production configuration validator that refuses to start the service if a required security
  setting is missing, default or weak.

**Technical**

- TLS in transit; HTTP Strict Transport Security; a restrictive set of security headers.
- Passwords stored as salted hashes; new and changed passwords checked against known-breached
  password corpora using a privacy-preserving range query.
- Multi-factor authentication, enforced for privileged roles, with encrypted TOTP seeds, single-use
  codes and hashed recovery codes.
- Short-lived session tokens in HTTP-only cookies, CSRF protection on state-changing requests, and
  server-side session revocation.
- Rate limiting and lockout on authentication endpoints.
- **Tenant isolation by separate database schema per customer**, so one customer's queries cannot
  reach another customer's tables.
- **Least-privilege database access**: the application role holds data rights only and cannot alter
  database structure. A separate provisioner credential, held by a separate process, performs
  migrations and tenant provisioning.
- Append-only activity logging of notable actions, with the actor, time and affected record.
- Automated mutation auditing of state-changing API requests.
- Encrypted backups with periodic restore testing.
- Full-disk encryption required on any device holding an offline copy of customer data.

**Physical**

- Hosting in the facilities of the infrastructure providers named in the
  [Sub-processor register](/legal/subprocessors), each operating under recognised security
  certifications.

We may change these measures, provided the overall level of protection is not reduced.

## 6. Sub-processors

6.1 You give general authorisation for us to engage the sub-processors listed in the
[Sub-processor register](/legal/subprocessors).

6.2 We impose data protection obligations on each sub-processor that are no less protective than
this Addendum, and we remain fully liable to you for their performance.

6.3 We will give at least 30 days' notice before adding or replacing a sub-processor, by updating
the register and notifying account administrators. If you reasonably object on data protection
grounds within that period, we will work with you in good faith; if we cannot resolve it, you may
terminate the affected part of the Service and receive a pro-rata refund of prepaid, unused fees.

## 7. Cross-border processing

7.1 Some sub-processors process outside the Philippines. The register states where.

7.2 Section 21(b) of the Data Privacy Act keeps us accountable for personal information transferred
to a third party. We contractually require protections at least equivalent to this Addendum, and we
minimise what crosses a border.

7.3 In particular, the Drying Advisor transmits **only weather data**: coordinates, place name and
forecast values already reduced to a fixed vocabulary of condition labels on our servers. No
personal information and no Customer Data are transmitted to the language model provider. There is
no chat interface and no free-text input path to that provider.

7.4 The AI advisor (Enterprise plan) transmits Customer Data to the language model provider, DeepSeek,
in the People's Republic of China, **only after your account's owner switches it on**, which is your
documented instruction to do so; switching it off withdraws that instruction for all later
processing. While it is on, we transmit figures computed from your records and the names of your
customers, suppliers and staff, and never telephone numbers, addresses, tax identification numbers,
government identifier numbers, or text your users typed into notes, remarks or descriptions. We
record who switched it on or off and when. {{deepseek_training_optout}}

## 8. Audit

8.1 On reasonable written notice, not more than once in any 12 months unless a breach has occurred
or a regulator requires it, we will provide documentation about our security measures and answer a
reasonable security questionnaire.

8.2 Where that is insufficient for you to demonstrate compliance, we will permit an audit by you or
an independent auditor bound by confidentiality, during business hours, without unreasonable
disruption, and excluding access to other customers' data, our commercially sensitive information,
and any multi-tenant infrastructure we do not control. You bear the cost unless the audit reveals a
material breach of this Addendum by us.

## 9. Return and deletion

9.1 During your subscription you may export your Customer Data at any time.

9.2 For {{data_export_window_days}} days after termination, you may request an export in a
structured, machine-readable format.

9.3 After that window we will delete or irreversibly anonymise Customer Data within
{{data_deletion_days}} days, except for copies in routine encrypted backups, which are deleted on
their normal rotation cycle and remain subject to this Addendum until then, and except where a law
requires us to retain a record.

9.4 On request we will confirm deletion in writing.

## 10. Personal data breach

10.1 We will notify you without undue delay, and in any event **within 24 hours** of becoming aware
of a personal data breach affecting your Customer Data.

10.2 The notification will describe, to the extent known: the nature of the breach; the categories
and approximate number of data subjects and records; the likely consequences; the measures taken or
proposed; and a contact point. We will supply further information as it becomes available.

10.3 We will take reasonable steps to contain and remediate the breach, preserve evidence, and
assist you in meeting your own 72-hour notification duty to the National Privacy Commission and to
affected data subjects under NPC Circular 16-03.

10.4 We will not make any public statement identifying you as affected without your prior written
consent, unless a law or regulator requires it.

## 11. Liability

The limitations and exclusions of liability in the Terms of Service apply to this Addendum, except
where the Data Privacy Act does not permit them to.

## 12. Governing law

This Addendum is governed by the laws of the {{governing_law}}, with venue as stated in the Terms
of Service.
