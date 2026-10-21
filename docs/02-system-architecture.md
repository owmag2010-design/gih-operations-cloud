# System Architecture

## 1. Shape

A **modular monolith**: one Next.js application, one PostgreSQL database, clear module boundaries inside the code. No microservices until a module has a real reason to scale or deploy on its own.

```
Browser (staff app, later client portal)
   │  HTTPS, session cookie
   ▼
Next.js 16 (App Router, Node runtime)
   ├─ proxy.ts ............ cheap edge checks: security headers, cookie presence
   ├─ app/ ................ routes, server components, server actions (UI layer)
   └─ src/server/ ......... everything that touches data or secrets
        ├─ auth/ .......... sessions, passwords, MFA, invitations, throttling
        ├─ access/ ........ permission catalogue, role resolution, guards
        ├─ db/ ............ Drizzle schema, connection, firm-scoped transactions
        ├─ modules/
        │    ├─ org/ ...... organisation, firms, offices, departments
        │    ├─ people/ ... staff, memberships, invitations
        │    ├─ intake/ ... Hub intake queue and routing engine
        │    ├─ crm/ ...... leads, pipeline, activities, saved views, duplicates
        │    ├─ clients/ .. client records, lead conversion
        │    ├─ metrics/ .. Command Centre queries
        │    └─ audit/ .... append-only audit events
        └─ integrations/ .. adapters: email (Resend), later Stripe, Anthropic, WhatsApp, Graph
   ▼
PostgreSQL 16  (row-level security on every firm-scoped table)
```

### Layer rules
1. **UI never touches the database.** Pages and server actions call module services.
2. **Every service takes an `AccessContext`** (who, which firms, which permissions). Services check permissions first, then run their queries inside a firm-scoped transaction.
3. **Integrations sit behind interfaces.** Each adapter has a real implementation and a "not configured" implementation that records the attempt and reports clearly that nothing was sent.
4. **Validation at the edge of every service** with Zod. Server actions parse `FormData` through the same schemas.

## 2. Key decisions

| # | Decision | Why |
|---|---|---|
| ADR-1 | Next.js 16 App Router, TypeScript, Tailwind v4, Radix primitives, Lucide | The stack in the master instruction; one language front to back |
| ADR-2 | **Drizzle ORM** over Prisma | SQL-first, gives direct control of the per-transaction settings that row-level security needs, plain SQL migrations that can carry policies |
| ADR-3 | **Firm isolation in two layers**: service-level scoping and PostgreSQL row-level security | A bug in one layer is caught by the other. The app connects as a role that cannot bypass RLS |
| ADR-4 | **Cache Components turned off** | Every screen is per-user and permission-dependent. Revoked access must take effect on the next request; per-session caches would let stale permissions linger for minutes |
| ADR-5 | **Self-hosted session auth for Release 1**, behind an `auth` module | No managed identity provider credentials are available yet. Sessions are server-side, hashed and revocable; MFA is TOTP. The module boundary lets a managed provider (Clerk, WorkOS, Entra ID) replace it later without touching modules |
| ADR-6 | Server actions for UI mutations, route handlers for machine callers (webhooks, health) | Server actions keep forms simple and are re-authorised on every call; webhooks need signatures and raw bodies |
| ADR-7 | Money stored as integer minor units with an ISO currency code | No floating-point fees; multi-currency from day one |
| ADR-8 | Firm references (`VE-L-000123`) from a per-firm sequence table | Human-readable, gap-tolerant, unique per firm, no cross-firm leakage |
| ADR-9 | Background jobs deferred to Release 2 (Trigger.dev) | Release 1 has no long-running work; adding a job runner now would be unused infrastructure |

## 3. Request lifecycle (staff screen)

1. `proxy.ts` adds security headers and sends visitors without a session cookie to `/login`.
2. The page calls `requireStaff()` which loads the session by hashed token, checks expiry, MFA status and user status, and builds the `AccessContext` from current memberships. Nothing is cached between requests.
3. The page calls a module service with that context. The service checks the permission (`leads:view`), then opens a transaction that sets `app.user_id` and `app.firm_ids` (only the firms the user may see) before querying.
4. PostgreSQL row-level security filters rows to those firms regardless of the query written.
5. Mutations write an audit event in the same transaction.

## 4. Environments

| Environment | Purpose | Data |
|---|---|---|
| Local | Development | Local Postgres, labelled configuration seed only |
| Test | Automated tests | Separate database, reset per run |
| Staging | Acceptance testing before release | Managed Postgres, no real client data until security review passes |
| Production | Live | Managed Postgres in-region (POPIA position to confirm), backups, monitoring |

Hosting target: Vercel (Node runtime) plus managed PostgreSQL (Neon, Supabase or AWS RDS; the choice depends on data-residency advice). Object storage arrives in Release 4.

## 5. Security posture
- Passwords hashed with argon2id; session tokens are 256-bit random values, stored only as SHA-256 hashes.
- Cookies: `HttpOnly`, `Secure` in production, `SameSite=Lax`, host-only.
- Server actions rely on Next.js origin checks for CSRF; the intake webhook uses an HMAC-SHA256 signature with a timestamp to stop replay.
- MFA secrets encrypted at rest with AES-256-GCM using a key from the environment.
- Audit table is insert-only for the application role.
- Content Security Policy, frame denial, referrer and permissions policies set in `proxy.ts`.
