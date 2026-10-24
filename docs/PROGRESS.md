# Progress Log

## 24 Oct 2026: Milestone 2 (part 1): matters, tasks, notes and calendar
**Done:**
- **Matters** under clients (`src/server/modules/matters`): open from a client or an accepted proposal; stages configurable per practice and per service (default set: opening → documents → preparation → review → submission → follow-up → outcome → closed); applicants and dependants with status and passport expiry; facts tagged verified / client statement / staff assessment (verification needs evidence and records who and when); deadlines and key dates with their basis (recorded from a document, calculated from a practice-validated rule, or adjusted with a reason and reviewer); team (case manager, consultant, members); restricted matters visible only to the team and practice administrators, enforced in PostgreSQL row-level security as well as the service; activity history.
- **Tasks**: personal (owner only), team (unassigned, anyone in the practice can take) and assigned; linked to a matter, client or lead; priority, due date or all-day, reminder, daily/weekly/monthly/yearly repeats; task templates that fire when a matter opens or reaches a stage (once per matter). Overdue count badge in the navigation.
- **Notes**: internal or client-visible, with full revision history, soft delete, and search limited to what the person may see. Used on matters and clients.
- **Calendar**: month grid and agenda in the viewer's time zone; events (consultation, appointment, biometrics, interview, submission, meeting) with the event's own time zone; also shows task due dates, matter deadlines, expiry and submission dates and lead follow-ups from their own records.
- My day now includes overdue tasks, reminders, matter deadlines in the next two weeks, and open matter counts per practice. New permissions: `matters:view_all`, `matters:view_assigned`, `matters:create`, `matters:edit`, `tasks:view_team`. Migrations 0016–0017.
- Tests: 93 unit/integration and 12 end-to-end (including axe on the matter, tasks, calendar and matter settings pages).

**Part 2: Airtable read mirror** (`src/server/modules/mirror`, docs/16-airtable-mirror.md): 30 tables across five bases registered from `data/config/airtable-sources.json`; full import and 15-minute incremental syncs by Airtable's modified time, full reconciliation every six hours; stable `rec…` ids, linked and reverse-linked records, calculated fields flagged, attachments opened through fresh links; last sync, errors, back-off and manual retry; reconciliation of counts, removed records (kept, never deleted), broken links and clients not yet in the dashboard; source of truth defined per dataset. Hub datasets need the new `mirror:view` permission; practice datasets stay within the practice. Read-only until write-back rules are agreed. Needs `AIRTABLE_TOKEN` to start importing. 96 unit/integration and 12 end-to-end tests pass.

**Next:** Milestone 3: document drafting, template management, proposals, invoices and payment reconciliation.

## 24 Oct 2026: New interface ("Editorial Daylight")
**Done:** Owen chose direction B from the three concepts. New top-bar shell with pill navigation and a mobile drawer; warm light palette; practice accent colours (Hub navy/red, Veritas magenta, Mimshac gold, Nextmove teal); per-person light / dark / match-device choice in the account menu (`users.ui_theme`, migration 0015); "My day" at `/today` as the landing page for everyone (greeting, what needs you, practice tiles, coming up), built only from records the person can access (`src/server/modules/today`). 81 unit/integration tests and 10 end-to-end tests (including axe in light and dark) pass.

## 24 Oct 2026: Milestone 1 of the expanded brief: email workspace and navigation
**Done (tested):**
- Navigation rebuilt around the eleven workspaces (Overview, Inbox, Enquiries & Deals, Clients & Matters, Tasks & Calendar, Documents & Templates, Proposals & Finance, Knowledge & Updates, Content, Reports, Settings). Unbuilt ones are marked "Soon" and open an honest page saying what's coming and when.
- One Inbox across every mailbox a person may read (Hub and each practice), with filters (practice, mailbox, assignee, status, linked, unread), search including message text, drafts, internal notes (styled apart, never sent), assignment, linking to enquiries and clients, "create enquiry from this email", delivery and failure states (accepted vs delivered).
- Compose, reply, reply all and forward with To/CC/BCC, attachments, templates with editable sections, missing-field checks, desktop/mobile/plain-text preview, autosaved private drafts. The sending address is always shown.
- Mailbox connections for Microsoft 365 (Graph) and Gmail (Gmail API) by OAuth: encrypted tokens, signed state bound to the browser, connection health and reconnect, 90-day history import with progress and de-duplication, provider thread ids, sync every 5 minutes (Vercel Cron) plus "Sync now", sending through the provider (counts as sent only when the provider accepts), attachment download on demand. Personal mailboxes are private to their owner, enforced in the database too.
- HTML template library: 8 Hub designs taken from emails already sent through Resend (anonymised) and 2 Veritas plain templates; HTML is sanitised; `{{edit:…}}` sections; merge fields checked on save and before sending; generated plain-text version.
- Signatures per practice and per person, chosen automatically, exactly one per message, with live preview.
- 88 unit/integration and 9 end-to-end tests passing.

**Blocked on Owen:** Azure app registration (Microsoft 365), Google OAuth client (Gmail), `CRON_SECRET` in Vercel. Steps in `10-deployment.md`.

**Next (milestone 2):** Airtable mirror and reconciliation, matters under clients, tasks, notes and calendar.

## 23 Oct 2026: Hub branding, email, and Release 2 proposals (first pass)
**Done (branch `release-2-proposals`, tested):**
- Global Immigration Hub branding: official logo (from the Hub's Logo folder), website v4 palette (navy #1B263B, red #DD1929), Newsreader display type, branded sign-in.
- Email via Resend: mailboxes per inbox (Hub + each firm), branded templates with merge fields and live preview (Hub templates shared with firms; firms can add their own), send to a lead or client, Hub and firm inboxes, replies threaded by a tagged reply-to address, delivery status from webhooks. Hub mail opens a Hub intake enquiry; firm mail links to the matching lead or client or offers "Create lead".
- Services: editable fees with price history (every change is a version).
- Proposals: create from a lead with catalogue services, edit content and fees, review → approve → send, secure expiring client link with accept/decline, versions, branded PDF (Veritas, Mimshac, Hub-navy default).
- 69 unit/integration tests passing.

**Resend set-up (done in Owen's account):** receiving domain `in.thegih.com` (MX + DKIM records for Owen to add), webhook to `/api/email/webhook`. Outlook rules must *redirect* each real mailbox to its receiving address.

**Next:** AI-drafted proposals (needs an Anthropic API key), Stripe deposit links, port the photo-rich proposal designs, attachment download, custom domain.

## 21 Oct 2026: Release 1 complete
**Done:** everything in the Release 1 list in `07-roadmap.md`, an independent security review with all high and medium findings fixed, 42 unit/integration and 7 end-to-end tests passing, full documentation set.

**Repository:** `owmag2010-design/gih-operations-cloud`, branch `main`.

**Not production-ready yet.** Before real client data: work through the checklist in `10-deployment.md` (hosting, database region and POPIA position, backups and a restore test, Resend email, monitoring, operational acceptance by each firm).

## Next session: start Release 2 (proposals)
1. Read `07-roadmap.md` (Release 2) and `14-known-limitations.md`.
2. Decide with Owen: hosting (Vercel + which PostgreSQL provider and region), and whether proposals reuse the existing Veritas, Mimshac and Hub proposal designs as templates (recommended: yes).
3. First build step: editable services and fees with version history (needed by proposals), then the proposal data model and approval workflow.

## Decisions log
| Date | Decision | Where |
|---|---|---|
| 21 Oct 2026 | Drizzle ORM; firm isolation in services and PostgreSQL RLS | ADR-2, ADR-3 |
| 21 Oct 2026 | Cache Components off so revoked access applies immediately | ADR-4 |
| 21 Oct 2026 | Self-hosted sessions and TOTP for Release 1, behind an `auth` module | ADR-5 |
| 21 Oct 2026 | Hub administrators act inside a firm only when that firm's policy allows it | Security review H1 |
| 21 Oct 2026 | Fee schedule of 20 Oct 2026 seeded for Veritas and Mimshac; Nextmove fees pending | `data/config/` |
