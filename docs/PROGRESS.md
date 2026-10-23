# Progress Log

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
