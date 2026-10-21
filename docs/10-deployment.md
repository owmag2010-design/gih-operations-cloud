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
