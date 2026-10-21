# Working on GIH Operations Cloud

Read `docs/PROGRESS.md` first: it records what is done and what comes next. The master brief is summarised in `docs/01-product-requirements.md`.

## Non-negotiables
- Every data access goes through a service in `src/server/modules/**` that takes an `AccessContext`, checks the permission for the specific firm, and runs inside `withScope()`. Never query firm-owned tables with `db()` directly.
- The app connects as `gih_app` (row-level security applies). Migrations run as the owner. New firm-owned tables need a `firm_id`, an RLS policy and composite foreign keys to their parents (see `drizzle/0002_security.sql`).
- Group roles never grant firm record access. Firm membership does.
- No fictional operational data. Demo data, if ever needed, is clearly labelled.
- Nothing is called working until it has a test. Update `docs/14-known-limitations.md` when you leave something incomplete.

## Next.js 16 notes
This is Next.js 16: `proxy.ts` replaces middleware; request APIs and `params` are async; Cache Components are deliberately off (ADR-4). Read `node_modules/next/dist/docs/` before using an unfamiliar API.

## Commands
`npm run dev` · `npm test` · `npm run test:e2e` · `npm run lint` · `npm run typecheck` · `npm run db:generate` (after schema changes) · `npm run db:migrate` · `npm run db:seed`

## Style
Plain sentence-case copy; buttons name the action. Use the components in `src/components/ui`. Tokens live in `src/app/globals.css`.
