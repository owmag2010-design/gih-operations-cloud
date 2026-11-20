# KONDESK reference and requirements matrix

Prepared 21 Nov 2026. This document compares KONDESK, which we are replacing, with GIH Operations Cloud, which we are building.

## Evidence
- **O (observed):** seen in Owen's KONDESK account in an authorised, read-only session on 21 Nov 2026. I recorded only the navigation, screen headings, column headings and form labels. No client records were opened, exported or changed.
- **P (public):** from the KONZE product pages and from GetApp, Capterra and SourceForge listings.
- **X (proposed):** not in KONDESK. Added because the brief requires it.

**About the KONDESK account:** it holds 10 leads (9 of them open) and has no lead sources configured. The lead list offers "Export to Excel" with a choice of columns, so we can migrate by export. No public API was found.

## Status in GIH Operations Cloud
- **Built:** in production code and tested.
- **Built (this branch):** in the `countries-jurisdictions` pull request.
- **Partial:** started but not complete.
- **Planned:** in the roadmap and not yet built.
- **Not planned:** we have decided not to build it.

## Disposition
Each KONDESK feature gets one of:
- **Retain:** keep it largely as KONDESK does it.
- **Redesign:** keep the purpose, rebuild it better.
- **Replace:** meet the need a different way.
- **Optional:** build only as a module that can be switched on.
- **Exclude:** don't build it.

## 1. Feature matrix

| # | KONDESK module / screen | Business need | Ev. | Disposition | Ops Cloud status | Phase | Acceptance |
|---|---|---|---|---|---|---|---|
| 1 | Dashboard (totals, lead levels, lead source, monthly charts, birthdays, announcements) | See what needs attention | O | Redesign | Built ("My day", Command Centre, real counts only) | — | Shows overdue tasks, unassigned leads, deadlines and blocked matters for the signed-in person. No invented numbers. |
| 2 | Enquiry list: offline and online, import, migrate to lead, duplicate confirmation, bulk update and delete | Capture and triage enquiries | O | Redesign | Built (Hub intake, routing rules, signed webhook, duplicates) | — | An enquiry becomes exactly one lead. Duplicate leads are flagged, never created silently. |
| 3 | Lead list: status set, levels 1–5, source, country, assignee, follow-up by type and period, bulk lead update, lead transfer | Work leads to a decision | O | Retain + redesign | Built (pipeline, board, follow-ups, bulk assign and stage, saved views) | — | Unassigned and overdue leads are visible, and any reassignment is audited. |
| 4 | Lead import and "Migrate" | Bring in existing data | O | Retain | Partial (CSV export done; import with preview is planned) | 2 | The import shows a preview, catches duplicates and keeps the source ID. |
| 5 | Lead statuses (Wrong number … Closed lost) and lead levels | Qualification | O | Retain | Built (configurable stages; won and lost categories) | — | Stages can be configured per practice, and lost reasons are recorded. |
| 6 | Lead campaigns (source, unique name, dates) | Attribute leads to campaigns | O | Retain | Planned | 3 | Every lead carries its source and campaign. Reports group leads by campaign. |
| 7 | Quotes (draft, quote to invoice, cancelled) | Price a service | O | Redesign | Built (proposals: review, approval, versions, client link, acceptance) | — | A quote can't be sent without approval. Acceptance is recorded separately from payment. |
| 8 | Invoices (draft, pending, partial, paid, cancelled, delete with reason) | Bill and track payment | O | Redesign | Built (gap-free numbering, credit notes, no deletion, verified payments) | — | An invoice is marked paid only by a verified payment or a signed provider event. Issued invoices are never deleted. |
| 9 | Stripe surcharge table ("client pays / you receive") | Card fees | O | Optional | Planned | 3 | Surcharge rules are set per practice and country, and the client is shown them before paying. |
| 10 | Promo categories, promo coupons, cashback vouchers | Discounts | O | Exclude (discount lines cover the need) | — | — | Discounts appear as discount lines on proposals and invoices. |
| 11 | Accounts: voucher detail, groups, ledger, invoice settlements | Bookkeeping | O | Replace (accounting integration, e.g. Xero) | Not planned (by design, L47) | — | Approved finance exports and sync to the practice's own accounting package. |
| 12 | Documents: document list, per-service checklist, "Manage documents" (pending verification, verified, rejected, pending from client, due date) | Collect and check documents | O | Redesign | Partial (documents and uploads with OCR are built; checklists are not, L43) | 2 | Per-country, per-service checklists. Received, reviewed and accepted are separate states. Requests have due dates and reminders. |
| 13 | Service set-up: price fixed or range, visa application fee, tax, country, onshore/offshore, occupation, VEVO check, document checklist by main applicant, sponsor or relationship | Define services | O | Redesign | Partial (services with versioned fees, destination country and fee-line types; checklists still to come) | 2 | Each service names its destination. Service fees, government fees and third-party costs stay separate. Checklists are versioned. |
| 14 | Company / branch (registration no., working days, office time, address) | Multiple branches | O | Redesign | Built (firms, offices); registered country added on this branch | — | Each legal entity is isolated. A user can belong to several practices. |
| 15 | Advanced settings: time zone, currency, date and time format (one per account) | Localisation | O | Redesign | Built (this branch: per-country profiles) | 1 | AUD, NZD and ZAR. Formats and calendars are set per country, not per account. |
| 16 | Roles and permissions (parent role, branches), dashboard permission | Access control | O | Redesign | Built (group and firm roles, server-side checks, row-level security) | — | Every server operation is checked. Isolation between practices and branches is tested. |
| 17 | Users, all users, email signature design | Staff and signatures | O | Retain | Built | — | — |
| 18 | Email templates per event across email, SMS and WhatsApp, with Meta WhatsApp template approval states | Consistent communication | O | Redesign | Partial (email templates built; WhatsApp sending runs through the engine) | 3 | Each template records which channels it supports. WhatsApp templates show their approval state from the provider. |
| 19 | Appointments: calendar, book appointment, sync settings | Consultations | O | Retain | Partial (calendar built; external sync L39, public booking link planned) | 3 | Bookings respect each person's time zone. Rescheduling keeps the history. |
| 20 | Tasks: status, priority, task transfer with approval, system and email alerts | Ownership of next actions | O | Retain | Built (tasks, templates, repeats); transfer approval not built | 3 | — |
| 21 | Study Abroad: admission pipeline (admission → offer → signed offer → confirmation/COE → visa), students, institute and course master lists, institute agreements | Education placement | O | Optional | Planned | 4 | An optional module covering institutions, programmes, intakes, offers and enrolments, linked to the client and the matter. |
| 22 | Commission: institute management (CRICOS, financial agreement, offer, bonus), agents and sub-agents, sales forecast (student-wise claims), credit note, commission invoice, bad debt | Partner and institution commissions | O | Redesign | Planned | 4 | The agreement is snapshotted when a commission is created. Claims track receivable, partial payment, dispute and clawback. |
| 23 | Coaching: tutors, batch locations, batches, sessions, enrolment | Language coaching | O | Exclude unless confirmed | — | — | Can be added later as an optional module if a practice runs coaching. |
| 24 | PTE vouchers | Test vouchers | O | Exclude | — | — | — |
| 25 | Insurance: OSHC policies purchased, refund requests | Health cover for students | O | Optional | — | 4+ | Only if student placement starts. Uses a provider integration, not manual policy records. |
| 26 | HR: holidays, shifts, rosters, weekend policy, attendance, leave categories, types, approval, late login, extra shift; payroll attendance report (Xero timesheets) | Staff administration | O | Exclude | — | — | Payroll and HR stay in dedicated tools (brief §13). |
| 27 | Analytics: revenue (created vs received, by service, growth, top agents) and leads (status, overdue follow-ups, creation vs conversion, source comparison, top users) | Management reporting | O | Redesign | Partial (finance reports built; lead analytics planned) | 3 | Every metric is defined with its date basis. Totals drill down to the underlying records without breaking permissions. |
| 28 | Audit report | Accountability | O | Retain | Built (append-only audit at organisation and firm level) | — | — |
| 29 | Course (settings) and announcements | Internal notices | O | Exclude for now | — | — | — |
| 30 | Integration centre (see §2) | Connect providers | O | Redesign | Partial | 3 | Uses only the honest states: not configured, awaiting access, testing, connected, degraded, disconnected. |
| 31 | API key, IP filtering | Security | O | Retain | Partial (signed webhooks; IP filtering not built) | 3 | — |
| 32 | 3CX walk-in registration, "Capture visit" | Front-desk capture | O | Optional | — | 4+ | — |
| 33 | Client portal | Clients self-serve | P (mobile app) / X | Redesign | Planned (Release 4) | 2 | Clients see only their own matters. Belonging to a household doesn't expose everyone's documents. Internal notes are never shown. |
| 34 | Country-specific workflow | Different processes per country | P ("country specific admission workflow") | Redesign | Built (this branch: country profiles); per-country workflow templates are next | 2 | Templates are versioned per country and service, and existing matters are never silently changed. |
| 35 | Calculators (KONPARE, SearchMyANZSCO, points tests) | Assessment tools | P | Optional, disabled until verified | — | 5 | Each calculator records its jurisdiction, source, effective date, version, tests and owner. |
| 36 | Automation (rules engine) | Less manual work | P (Zapier) / X | Redesign | Planned | 4 | Versioned and pausable, with approval gates, execution history, and protection against loops and duplicates. |
| 37 | AI assistance | Drafting and summaries | X | Redesign | Partial (AI drafting with consent and minimisation) | 5 | Respects the same permissions as staff. Cites its sources. Never sends or submits on its own. |
| 38 | Countries: AU, NZ, ZA native | Multi-jurisdiction | X (brief §3) | — | Built (this branch) | 1 | See docs/19-countries.md. |

## 2. Integrations matrix

For each provider: where KONDESK lists it, where it applies, how we would assess it, and its status in GIH Operations Cloud.

| Provider | Purpose | Seen in KONDESK | Geography | Assessment | Ops Cloud status |
|---|---|---|---|---|---|
| Microsoft 365 / Outlook | Email, calendar | P | All | Retain. Veritas runs on Microsoft 365. | Built. Needs an Azure app registration (L25). |
| Gmail / Google Workspace | Email, calendar | O, P | All | Retain | Built. Google verification needed for personal accounts (L34). |
| SMTP (Gmail, Live, Yahoo) | Email | O | All | Replace with provider APIs | — |
| Resend | Transactional email | X | All | Retain | Built. Domains to verify (L1). |
| Google Drive, OneDrive, Dropbox | Document storage | O, P | All | Optional. Private object storage is the record; drives are exports only. | Planned |
| Meta WhatsApp (Cloud API) | Messaging | O | All | Use through Infobip, which Owen already uses | Engine (Infobip) live; Ops Cloud reads and relays |
| Gallabox, MyOperator, Servetel, Lucep, Twilio | WhatsApp, calls, SMS | O, P | India-focused (except Twilio) | Exclude, except Twilio for SMS if needed | — |
| Sulekha, Shiksha, Justdial | Lead sources | O | India | Exclude: not GIH's market | — |
| Facebook / Meta lead forms | Lead intake | O | All | Retain via signed webhook or Make | Planned |
| WordPress contact form | Lead intake | O | All | Retain: practice websites post to the intake webhook | Built (signed intake webhook) |
| Zapier, Make | Automation | O / X | All | Retain Make, which Owen already uses | Make scenarios exist outside the app |
| Stripe | Card payments | O, P | AU, NZ, ZA: check per entity | Retain. Verify one test transaction per entity and country. | Built. Waiting on keys (L48). |
| Razorpay, Cashfree | Payments | O, P | India | Exclude | — |
| Xero | Accounting | O (payroll export) | AU, NZ, ZA | Optional. Assess per entity. | Planned |
| Zoho Books | Accounting | X (Owen uses it) | ZA | Assess | Planned |
| KONSIGN / DocuSign | E-signature | O / X | All | Replace KONSIGN with DocuSign or similar | Planned |
| Google Meet, Microsoft Teams, Zoom | Virtual meetings | P | All | Optional | Planned |
| Airtable | Existing records | X | — | Read mirror for migration | Built (mirror, 147 Hub clients) |

Every integration must record, before it can be called "connected": owner, permissions, objects synced, direction, source of truth, conflicts, cursor or backfill, duplicates, retries, disconnect behaviour and logs. A verified test transaction per entity and country goes in the practice-by-country checks (Hub › Countries).

## 3. Migration from KONDESK
- **Source:** 10 leads, plus whatever services, templates and documents are configured.
- **Route:** the lead list's "Export to Excel" (choose columns), then import into Ops Cloud with a preview and duplicate check, keeping the KONDESK lead code as the source ID. Documents are downloaded one lead at a time.
- **Not yet done:** this needs Owen's go-ahead because it exports client data. Nothing was exported in the read-only session.

## 4. Open questions that change the product
1. Which country is each practice (legal entity) registered in? Veritas Emigrate (Pty) Ltd, Mimshac Group and Nextmove Advisory.
2. Which practice serves AU and NZ clients, and who holds the AU registration (OMARA) and NZ licence (IAA)? Should Bega and Canberra be added as offices?
3. Zimbabwe: bill in USD or ZWG?
4. Is study-abroad and education placement (institutions, offers, COE, commissions) a real line of work now, or later?
5. Should the KONDESK leads be migrated, or left to close out in KONDESK?
