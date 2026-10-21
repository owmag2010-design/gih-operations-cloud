# GIH Operations Cloud — Product Requirements

Owner: Owen Magocha, Founder, Global Immigration Hub
Status: Living document. Release 1 in development (started 21 Oct 2026).

## 1. Problem

Global Immigration Hub (GIH) is the shared front door for three independent immigration practices: Veritas Emigrate, Mimshac Group and Nextmove Advisory. Today the work is spread across Airtable (leads), Notion (client portals and knowledge), Pipedrive, Zoho Books, email, WhatsApp and local folders of proposal templates. Enquiries are arriving faster than they can be triaged by hand, and there is no single place that shows what is happening across the firms without mixing their records together.

## 2. Goal

One operating system for the Hub and its partner firms that carries a matter from enquiry to case closure, while each firm keeps its own records, staff, branding, pricing and client relationships.

## 3. Users

| User | What they need |
|---|---|
| Hub founder / group administrator | Cross-firm oversight from real numbers, firm configuration, staff and access control, routing rules, audit trail |
| Hub triage / operations staff | One intake queue; route each enquiry to the right firm; nothing sits unanswered |
| Firm administrator | Own firm's settings, pipeline, staff, services and pricing |
| Consultant / case manager | Their leads and clients, follow-ups, notes, conversion to client, later cases and documents |
| Reviewer, finance, document and support officers | Narrow, task-specific access (Releases 2–6) |
| Client | Mobile-first portal for their own case only (Release 4) |

## 4. Business rules that shape the design

1. **Firms are separate legal entities.** Client data is isolated by firm by default. Group-level roles do not see a firm's records unless that firm has granted access through a membership.
2. **The Hub triages, firms serve.** Hub enquiries land in a group intake queue and are routed to a firm. Firms may also capture their own direct leads.
3. **Default routing (configurable, first match wins):** legal matters (bans, overstay, V-list, appeals, refusals, refugee matters, detention, litigation) → Mimshac Group; clients in Zimbabwe → Mimshac Group; investment and corporate migration → Nextmove Advisory; everything else → Veritas Emigrate; unclear → held for a person.
4. **Asylum applications are out of scope.** Such enquiries are flagged for a consultation offer on other routes rather than routed as a matter.
5. **Regulated advice.** Australian enquiries go through a separate authorised consultation process; the system never issues immigration advice on its own in any jurisdiction.
6. **Human oversight of AI.** AI may draft and suggest; a person approves anything consequential.
7. **No fabricated data.** Dashboards show real counts or an honest empty state. Configuration seed data is labelled.
8. **Fees follow the approved fee schedule.** Totals are core fees; add-ons are separate; deposit is 50% of the total; consultations are paid in full.

## 5. Scope by release

| Release | Outcome |
|---|---|
| 1 — Enterprise foundation | Secure sign-in with MFA, firm workspaces, staff and roles, group Command Centre, Hub intake and routing, CRM, client records, audit log |
| 2 — Proposals | Assessment intake, proposal templates and editor, AI-assisted drafting, approvals, branded PDF, secure delivery, acceptance |
| 3 — Case operations | Cases, configurable workflows, tasks, deadlines, checklist templates |
| 4 — Client portal | Invitations, client sign-in, checklists, uploads, document review, secure messaging |
| 5 — Knowledge and AI | Versioned knowledge with approvals, RAG with citations, AI assessment, rules-based checklists, legal-change review |
| 6 — Enterprise expansion | Email/WhatsApp integrations, finance, reporting, Automation Studio, international configuration, migration utilities |

## 6. Release 1 functional requirements

### 6.1 Identity and access
- Email and password sign-in (argon2id hashing), server-side sessions in secure, http-only cookies, idle and absolute expiry.
- TOTP multifactor authentication; mandatory for group roles and firm administrators, optional for others (policy configurable).
- Invitation-only staff accounts with single-use, expiring links.
- Password reset with single-use, expiring links; all sessions revoked on reset.
- Sign-in throttling per account and per IP.
- Deactivating a user or removing a membership takes effect on the next request.

### 6.2 Organisation and firms
- One organisation (GIH) with many firms; each firm has legal name, trading name, reference prefix, brand colour, contact details, website, email domain, jurisdictions, offices and departments.
- Offices belong to the organisation and can be shared by several firms (GIH centres).
- Firm data-sharing policy: whether the group may see aggregate metrics.

### 6.3 Roles and permissions
- Configurable roles made of permission keys (`resource:action`).
- Group roles (organisation-wide functions) and firm roles (per-firm membership).
- Every check runs on the server; the interface only hides what the server would refuse anyway.

### 6.4 Hub intake and routing
- Signed webhook and manual entry create intake items.
- Routing rules suggest a firm; a person confirms, or an auto-route switch applies the rule.
- Routing an item creates a lead in the chosen firm and records who routed it and why.

### 6.5 CRM
- Lead fields as in the master instruction (identity, nationality, destination, category, enquiry, source, assignee, priority, stage, follow-up date, tags, custom fields, consent).
- Configurable pipeline stages per firm, seeded with the default 14 stages.
- Table, list, board (drag between stages), and calendar (follow-ups) views; saved views.
- Search, sort, filter, tags, bulk assign and bulk stage change.
- Duplicate detection on email and phone within a firm.
- Activity timeline with notes, stage changes and assignments.
- Convert a lead to a client (once, idempotent).

### 6.6 Clients
- Client records created by conversion or manually; linked back to the source lead.

### 6.7 Group Command Centre
- Real metrics: active firms, new enquiries, intake awaiting triage, open leads, active clients, overdue follow-ups, leads by stage and firm, consultant workload.
- Modules not yet built are shown as "not yet released", never as zero.

### 6.8 Audit
- Append-only audit events for sign-in, access changes, routing, lead and client changes, and exports.

## 7. Non-functional requirements
- Firm isolation enforced twice: in the data-access layer and by PostgreSQL row-level security.
- Light-first, accessible (WCAG 2.2 AA contrast) interface that works on phone, tablet and desktop.
- Every feature backed by the database; no clickable mock-ups.
- Each release ends with automated tests, a known-limitations update and a commit.

## 8. Out of scope for Release 1
Proposals, cases, documents, client portal, knowledge, AI, finance, email/WhatsApp sending, automation builder and data migration. They appear in navigation as clearly labelled future modules.
