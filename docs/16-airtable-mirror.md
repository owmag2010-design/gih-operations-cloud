# Airtable mirror

The dashboard keeps a **read-only mirror** of the Airtable tables the business still runs on, so the information appears here without changing how the WhatsApp bot, the gih-engine, the booking platform and the Make scenarios work.

## What it does

| | |
|---|---|
| Initial import | A full sync pages through every record of each configured table. |
| Incremental sync | Every 15 minutes (Vercel Cron, `/api/cron/airtable-sync`): records whose `LAST_MODIFIED_TIME()` or `CREATED_TIME()` is after the previous run (with a 5-minute overlap). |
| Reconciliation | A full sync at least every six hours, and on demand ("Full sync and reconcile"). It updates the Airtable record count and finds records that disappeared. |
| Identifiers | Airtable's own record ids (`rec…`). Links between tables resolve exactly by id. |
| Linked records | Shown by the linked record's primary value; unresolved ids are listed in reconciliation. Reverse links ("Linked from") are shown on each record. |
| Field types | Every field is stored as Airtable returns it (keyed by field id). Calculated fields (formula, lookup, rollup, count, created/modified time and by, auto number, button, AI text) are flagged and can never be edited from the dashboard. |
| Attachments | File names, sizes and types are stored. Airtable's download links expire after a few hours, so they are not stored: "open" fetches a fresh link from Airtable. Files stay in Airtable and Google Drive. |
| Status | Per dataset: last successful sync, last full sync, record counts, last error, next automatic attempt. Sync history keeps the last runs with counts. |
| Errors and retries | A failed sync records the error, backs off (10 min, doubling, up to 6 h) and retries automatically; "Sync now" retries immediately. |
| Views | Airtable views are filters, not data. The mirror copies the underlying records, never views. |

**This is not two-way synchronisation.** Nothing is written to Airtable from the dashboard.

## Retention

Records are never deleted from the mirror. A record missing from a complete full sync is marked **Removed in Airtable** with the time, kept as last seen, and shown under "Removed in Airtable" and in reconciliation. If it reappears it is restored. The application database role has no `DELETE` permission on mirrored records.

## Access

- **Hub datasets** (Global Immigration Hub base, Veritas WhatsApp Inbox base, GIH Contacts Database): Hub staff with `mirror:view` (Group Super Administrator, Group Operations Administrator). Enforced in row-level security (`app.mirror`).
- **Practice datasets** (Mimshac Group — Clients, Nextmove Advisory — Clients): members of that practice with `clients:view_all`. Group roles never see them.
- Syncs and pausing: `mirror:manage` (Hub), or a practice's administrators for its own datasets.

## Datasets and source of truth

Configured in `data/config/airtable-sources.json` (registered by the seed; edits made in the dashboard are kept).

| Dataset | Airtable | Source of truth | Why |
|---|---|---|---|
| Hub clients | Global Immigration Hub › Clients (CRM) | Airtable | The bot, triage and Make scenarios write here. Clients created in the dashboard are recorded in the dashboard. |
| Hub matters | › Matters | Airtable | The WhatsApp bot reads "Client update" from it. Matters opened in the dashboard are recorded in the dashboard. |
| Hub tasks and calendar, notes, activity log, documents | › Tasks & Calendar, Notes, Activity Log, Documents | Airtable | Written by the existing automations. |
| Consultation bookings | › Consultations | Airtable | Booking platform and Stripe write payment status there; the dashboard only shows it. |
| Partner firms | › Partner Firms | Shared | Practice profiles are kept in the dashboard; this table still feeds Airtable links. |
| Hub team (Airtable) | › Team | Shared | Sign-in and roles are in the dashboard; this table drives Airtable ownership and Slack routing. |
| Tally leads, Enquiries, WhatsApp inbound messages, bot sessions, WhatsApp contacts | Veritas WhatsApp Inbox | Airtable | gih-engine and the bot. New enquiries also reach the dashboard through the intake webhook. |
| Engine fee schedule | › Services & Fees | Shared | The engine prices from it; the dashboard's service catalogue holds the approved schedule with price history. |
| Contacts 2026 | GIH Contacts Database | Airtable | Mailing consent and Mailchimp status. |
| Mimshac clients, matters, tasks and calendar, notes, activity log, documents, team | Mimshac Group — Clients | Airtable (team: shared) | |
| Nextmove clients, matters, tasks and calendar, notes, activity log, documents, team | Nextmove Advisory — Clients | Airtable (team: shared) | |

Not mirrored: Invoice Tracker (finance, Milestone 3), Booking Settings (configuration), the untitled and Sales Strategy bases.

## Field mapping to dashboard records

The "Field mapping" tab of each dataset lists every field with its type, whether it is calculated, and which mirrored dataset a link points to. For migration, the main correspondences are:

| Airtable (Clients (CRM)) | Dashboard client |
|---|---|
| Client Name | first and last name |
| Email, Phone / WhatsApp Number | email, phone |
| Nationality | nationality |
| Case Manager (link to Team) | primary consultant (matched by email to a staff account) |
| Partner Firm (link) | the practice that owns the record |
| Status, Summary, Last Contact | not yet mapped (shown in the mirror) |

| Airtable (Matters) | Dashboard matter |
|---|---|
| Matter | title |
| Client (link) | client |
| Matter Type, Authority | legal category, submission channel |
| Status | stage (needs a status-to-stage table per practice) |
| Reference, Submitted On, Outcome | submission reference, submitted on, outcome |
| Decision Due | a dated entry recorded from Airtable |
| Fee, Balance | proposals and invoices (Milestone 3) |
| Client update (bot-shared text) | not mapped: stays in Airtable while the bot reads it |

Reconciliation for client datasets owned by a practice lists Airtable clients whose email doesn't match any dashboard client of that practice ("Not yet in the dashboard").

## Before switching on edits from the dashboard

Dashboard edits to mirrored data stay off until these are agreed and built:

1. **Direction per field.** Only stored (non-calculated) fields in datasets whose source of truth is "shared" or "dashboard" may be written; Airtable-truth datasets stay read-only.
2. **Write path.** Changes go through a queued update (`pending`, `sent`, `confirmed`, `failed`) using `PATCH` with `typecast: false`, so failures are visible and retried, never silent.
3. **Conflicts.** Before writing, re-read the record; if the field changed in Airtable since the dashboard read it, stop and show both values for a person to choose.
4. **Loop prevention.** Writes made by the dashboard are tagged (a "Last updated by" field set to the dashboard, or the API token's user) and ignored by Airtable automations and by the next incremental sync's change detection.
5. **Audit.** Every write is in the audit log with before and after values.

## Connecting

1. In Airtable, create a personal access token (Builder hub → Personal access tokens) with scopes `data.records:read` and `schema.bases:read`, and access to the bases listed above.
2. Add it in Vercel as `AIRTABLE_TOKEN` (Production), and redeploy.
3. Open Settings → Airtable mirror. The first scheduled run (or "Sync now") imports everything.
