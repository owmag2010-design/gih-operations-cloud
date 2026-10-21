# GIH Operations Cloud

Operations platform for **Global Immigration Hub** and its partner firms (Veritas Emigrate, Mimshac Group, Nextmove Advisory). One system from enquiry to client, with each firm's records kept separate.

**Status:** Release 1 (enterprise foundation) built and tested. Not yet production-ready: see [the deployment checklist](docs/10-deployment.md#deployment-checklist-before-real-client-data) and the [known-limitations register](docs/14-known-limitations.md).

## What works today
- Sign-in with two-step verification, invitations, password reset, session management
- Hub intake queue fed by a signed webhook or manual capture, with configurable routing rules
- Firm workspaces: leads (table, board, follow-up calendar, saved views, bulk actions, CSV export), clients, team, settings, audit log
- Group Command Centre with real counts from firms that share them
- Firm isolation enforced in the services **and** in PostgreSQL row-level security

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Radix UI · Drizzle ORM · PostgreSQL 16 · Vitest · Playwright

## Quick start
See [docs/10-deployment.md](docs/10-deployment.md). In short:
```bash
npm install
cp .env.example .env.local   # fill in
npm run db:migrate && npm run db:seed
npm run admin:create -- --email you@example.com --name "Your Name" --firm-admin-all
npm run dev
```

## Tests
```bash
npm test            # 42 unit and integration tests (database: gih_test)
npm run test:e2e    # 7 end-to-end tests incl. accessibility (database: gih_e2e)
npm run lint && npm run typecheck
```

## Documentation
| | |
|---|---|
| [Product requirements](docs/01-product-requirements.md) | [System architecture](docs/02-system-architecture.md) |
| [Database and firm isolation](docs/03-database-and-isolation.md) | [Roles and permissions](docs/04-roles-and-permissions.md) |
| [Navigation map](docs/05-navigation-map.md) | [Design system](docs/06-design-system.md) |
| [Roadmap](docs/07-roadmap.md) | [Integrations and configuration](docs/08-integrations-and-configuration.md) |
| [API](docs/09-api.md) | [Deployment](docs/10-deployment.md) |
| [Migration plan](docs/11-migration-plan.md) | [Security checklist](docs/12-security-checklist.md) |
| [Administrator guide](docs/13-administrator-guide.md) | [Known limitations](docs/14-known-limitations.md) |
| [Test report](docs/15-test-report.md) | [Progress log](docs/PROGRESS.md) |
