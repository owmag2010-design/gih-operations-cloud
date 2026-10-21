# Database Design and Firm Isolation

Schema source: `src/server/db/schema.ts`. Migrations: `drizzle/` (generated SQL plus hand-written `0000_extensions.sql` and `0002_security.sql`).

## 1. Entities (Release 1)

| Area | Tables |
|---|---|
| Organisation | `organisations`, `firms`, `offices`, `firm_offices`, `departments` |
| Identity | `users`, `sessions`, `mfa_recovery_codes`, `auth_attempts`, `password_resets`, `invitations` |
| Access | `roles` (permission keys), `group_memberships`, `firm_memberships` |
| CRM | `pipeline_stages`, `leads`, `activities`, `consent_records`, `saved_views`, `firm_sequences` |
| Clients | `clients` |
| Configuration | `services` (fee schedule), `routing_rules` |
| Hub intake | `intake_items` |
| Governance | `audit_events` (append-only), `email_outbox` |

Entities for later releases (cases, proposals, documents, knowledge, invoices, automation) are designed in the roadmap and added by migration when their release starts, so nothing in the database pretends to exist before it works.

### Conventions
- UUID primary keys (`gen_random_uuid()`), `timestamptz` everywhere, `citext` emails.
- Money as integer minor units plus ISO currency (`services.total_minor`, `currency`).
- Soft delete (`deleted_at`) on leads and clients so the audit trail stays meaningful.
- Human references per firm from `firm_sequences`: `VE-L-000123` (lead), `MG-C-000045` (client).

## 2. Isolation in two layers

### Layer 1: services
Every service function takes an `AccessContext`, checks the permission for the specific firm (`ctx.require("leads:edit", firmId)`), and opens its transaction with `withScope()` limited to that firm. Records outside the caller's scope raise `NotFoundError`, so ids cannot be probed.

### Layer 2: PostgreSQL row-level security
The application connects as `gih_app`, which does not own the tables. `withScope()` sets transaction-local settings:

| Setting | Meaning |
|---|---|
| `app.org_id` | Organisation of the caller |
| `app.user_id` | Caller (used by saved-view privacy) |
| `app.firm_ids` | Comma-separated firms readable in this transaction |
| `app.intake` | `on` when the caller holds intake permissions |
| `app.audit_scope` | `org` or `firm` for audit reads |

Policies (`drizzle/0002_security.sql`):
- `leads`, `clients`, `activities`, `consent_records`, `saved_views`, `pipeline_stages`, `firm_sequences`, `services`: rows visible and writable only when `firm_id = ANY(app_firm_ids())`. Unset means an empty list, so the default is deny.
- `saved_views`: additionally private to the owner unless shared.
- `intake_items`: only when `app.intake = 'on'` and the organisation matches.
- `audit_events`: anyone may insert; reading needs an audit scope. `UPDATE`, `DELETE` and `TRUNCATE` are revoked from `gih_app`, so the log is append-only.

Settings are `set_config(..., true)`, which lasts only for the transaction, so they cannot leak to another request sharing the pooled connection.

### Cross-firm integrity
Composite foreign keys stop a child row pointing at another firm's parent, even if application code were wrong: lead → stage, lead → duplicate lead, lead → converted client, client → source lead, activity → lead/client, consent → lead/client.

### Aggregates without row access
The Command Centre needs counts across firms the caller is not a member of. Two `SECURITY DEFINER` functions (`metrics_firm_summary`, `metrics_leads_by_source`) return counts only, and only for firms whose `share_aggregate_metrics` policy is on or which the caller belongs to. The application role never reads those firms' rows.

## 3. Tests that prove it
`tests/integration/isolation.test.ts`: unscoped reads return nothing; another firm's row is invisible by primary key; updates from the wrong scope change nothing; inserts for another firm violate the policy; cross-firm stage assignment fails the composite key; group roles get no record access; withheld firms are left out of aggregates. `tests/e2e/smoke.spec.ts` repeats the URL-tampering checks through the browser.

## 4. Managed database notes
On Neon, Supabase or RDS: create the `gih_app` role with a password and `LOGIN`, run migrations as the owner, and give the application only the `gih_app` connection string. Never connect the application as the owner or as a role with `BYPASSRLS`.
