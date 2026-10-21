# Progress Log

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
