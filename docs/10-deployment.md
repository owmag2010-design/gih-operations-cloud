# Deployment

## Local development
```bash
npm install
# PostgreSQL 16 with a database, an owner role and the gih_app role:
#   CREATE ROLE gih LOGIN PASSWORD '...' CREATEDB;  CREATE DATABASE gih_dev OWNER gih;
#   CREATE ROLE gih_app LOGIN PASSWORD '...';
cp .env.example .env.local        # fill in values
npm run db:migrate                # as owner
npm run db:seed                   # configuration only
npm run admin:create -- --email you@example.com --name "Your Name" --firm-admin-all
npm run dev
```
Open the printed link to set the password, then sign in; group administrators are taken straight to two-step sign-in set-up.

## Tests
```bash
npm test             # unit + integration (needs database gih_test)
npm run test:e2e     # builds, then runs Playwright against database gih_e2e
npm run lint && npm run typecheck
```

## Production (Vercel + managed PostgreSQL)
1. Create the managed PostgreSQL database in the agreed region. Create `gih_app` with `LOGIN` and a strong password. Never use a `BYPASSRLS` role for the app.
2. Run `npm run db:migrate` and `npm run db:seed` from a trusted machine with `MIGRATION_DATABASE_URL` set to the owner connection.
3. Create the Vercel project from the GitHub repository. Set `DATABASE_URL` (gih_app), `APP_URL`, `DATA_ENCRYPTION_KEY`, `INTAKE_WEBHOOK_SECRET`, and later `RESEND_API_KEY`, `EMAIL_FROM`. Do **not** set `MIGRATION_DATABASE_URL` in Vercel.
4. Deploy. Check `/api/health`.
5. Run `admin:create` once for the founder account, open the link, set the password and enrol two-step sign-in.
6. Point the domain (for example `ops.thegih.com`) at Vercel. HTTPS and HSTS are applied automatically.

## Deployment checklist (before real client data)
- [ ] Security review findings resolved or accepted in writing
- [ ] Database region and POPIA cross-border position confirmed
- [ ] Automated backups on; a restore tested into a scratch database
- [ ] `gih_app` confirmed without `BYPASSRLS`; owner credentials not in the app environment
- [ ] Secrets generated fresh for production (not copied from development)
- [ ] Resend domain verified and a real invitation email received
- [ ] Every administrator has two-step sign-in
- [ ] Monitoring (uptime on `/api/health`, error tracking) in place
- [ ] Operational acceptance test by a consultant in each firm
- [ ] Known-limitations register reviewed and accepted

## Live setup (21 Oct 2026)
| Item | Value |
|---|---|
| Database | Supabase project `gih-operations-cloud` (ref `hwcofcngqgtsqqkojdzg`), org "Global Immigration Hub" (Pro), region Sydney `ap-southeast-2` |
| App database login | `gih_app` (login, no BYPASSRLS, not superuser), via the transaction pooler on port 6543 |
| Owner connection | GitHub repository secret `MIGRATION_DATABASE_URL` (session pooler, port 5432); used only by the Database workflow |
| Hosting | Vercel team `gih-operations-cloud`, project `gih-operations-cloud-7qm1`, functions pinned to `syd1` (`vercel.json`) |
| Address | https://gih-operations-cloud-7qm1.vercel.app (custom domain to follow) |
| Vercel variables | `APP_URL`, `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `INTAKE_WEBHOOK_SECRET` (Production) |
| Migrations and seed | Database workflow run #2, `migrate-and-seed`, succeeded |

## Email connections (milestone 1)

Environment variables in Vercel (Production):

| Variable | What it is |
|---|---|
| `CRON_SECRET` | Any long random value (e.g. `openssl rand -hex 32`). Vercel Cron sends it to `/api/cron/mail-sync` every 5 minutes. |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Azure (Entra ID) app registration for Microsoft 365 mailboxes. Optional `MS_TENANT` (default `common`). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client for Gmail / Google Workspace mailboxes. |

**Microsoft 365 (Azure portal › Microsoft Entra ID › App registrations › New registration)**
1. Name: GIH Operations Cloud. Supported account types: "Accounts in any organizational directory" (multitenant), so Veritas, Mimshac and Hub tenants can all connect.
2. Redirect URI (Web): `https://<app domain>/api/mail/oauth/microsoft/callback`.
3. API permissions › Microsoft Graph › Delegated: `offline_access`, `openid`, `email`, `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Mail.ReadWrite.Shared`, `Mail.Send.Shared`. Grant admin consent for your organisation.
4. Certificates & secrets › New client secret → copy the value into `MS_CLIENT_SECRET`; the Application (client) ID into `MS_CLIENT_ID`.

**Gmail (Google Cloud console)**
1. Create a project, enable the Gmail API.
2. OAuth consent screen: Internal for a Workspace domain (no verification needed); External for personal Gmail (testing mode: add test users; tokens expire after 7 days until verified).
3. Credentials › OAuth client ID › Web application. Authorised redirect URI: `https://<app domain>/api/mail/oauth/google/callback`.
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

After adding variables, redeploy. Settings › Email shows each connection as Ready or Not set up.

## Airtable mirror (milestone 2)
- `AIRTABLE_TOKEN`: an Airtable personal access token with `data.records:read` and `schema.bases:read`, limited to the mirrored bases (see docs/16-airtable-mirror.md). Production only.
- Cron: `/api/cron/airtable-sync` every 15 minutes (in `vercel.json`), authorised by `CRON_SECRET`.
