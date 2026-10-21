# Development Roadmap and Acceptance Criteria

Status key: **Done** (built, tested), **Next**, **Planned**.

## Release 1 — Enterprise foundation: **Done** (21 Oct 2026)
Acceptance: users sign in securely, switch between authorised firms, manage leads and clients, and see real operational records.

- [x] Sign-in, sessions, TOTP two-step sign-in with recovery codes, throttling, invitations, password reset
- [x] Organisation, firms, offices (GIH centres), departments; firm policies
- [x] Configurable roles; group vs firm scope; subset rule; last-admin protection; immediate revocation
- [x] Firm isolation in services and PostgreSQL row-level security
- [x] Hub intake queue, signed webhook, routing rules with tester, manual capture, routing into firms
- [x] CRM: leads, configurable pipeline, table/board/calendar views, filters, saved views, bulk assign/stage/delete, duplicates, consent, notes, CSV export
- [x] Clients: conversion (idempotent), manual creation, notes, export
- [x] Group Command Centre and firm dashboards from real data
- [x] Audit log (append-only) at organisation and firm level
- [x] Service catalogue loaded from the approved fee schedule (Veritas, Mimshac)
- [x] 42 unit/integration tests, 7 end-to-end tests with accessibility checks, independent security review

## Release 2 — Proposals: **Next**
Acceptance: a lead moves through a real proposal workflow and becomes a client.
1. Assessment intake on the lead (structured facts, missing-information list)
2. Proposal templates per firm (the approved Veritas, Mimshac and Hub designs ported as templates)
3. Editable services and fees in firm settings (with version history)
4. Proposal editor: sections, pricing table built from services, dynamic fields, versions
5. AI-assisted first draft (Claude API) from the enquiry and approved templates; human approval required
6. Approval workflow (draft → review → changes → approved → released)
7. Branded PDF rendering (server-side), secure expiring proposal links, acceptance record
8. Payment request (Stripe link or EFT details per firm); background jobs (Trigger.dev)
9. On acceptance plus payment condition: client activated (re-using Release 1 conversion)

## Release 3 — Case operations: Planned
Cases with application type, jurisdiction, expiry dates and risk; configurable workflow stages with conditional and parallel steps; tasks with dependencies; deadlines and reminders; case board, table, timeline and calendar; checklist templates (rule version stored per checklist).

## Release 4 — Client portal: Planned
Separate mobile-first portal (`portal.` domain), client invitations and passwordless sign-in, case dashboard, checklist, resumable direct-to-storage uploads with malware scanning, document review and versioning, secure case messaging (internal notes never visible), notifications.

## Release 5 — Knowledge and AI: Planned
Versioned knowledge library with approval states, retrieval with citations (pgvector), AI-assisted assessment that cites approved sources only, rules-based checklist generation, legal-change review that flags affected cases instead of overwriting them.

## Release 6 — Enterprise expansion: Planned
Resend and Microsoft 365 email, WhatsApp Business (Infobip) messaging, finance (quotations, invoices, payments, reconciliation; client money kept per firm), advanced reporting and scheduled reports, Automation Studio, international configuration, migration utilities for Airtable, Notion and Pipedrive.

## Cross-cutting work to schedule
- Replace self-hosted authentication with a managed provider if required by the security review (the `auth` module is the only place to change)
- Sentry and structured logging once hosting is chosen
- Backup and restore drill before real client data
- POPIA operator agreement and data-residency decision for the database region
