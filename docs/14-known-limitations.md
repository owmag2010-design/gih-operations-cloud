# Known Limitations Register

Updated 21 Oct 2026, end of Release 1. Nothing here is hidden behind the interface: unbuilt modules are labelled "not yet released".

| # | Limitation | Impact | Plan |
|---|---|---|---|
| L1 | Email sending is not connected (no Resend key). Invitations show a one-time link for the inviter to pass on; password-reset links are only logged in development | Password reset cannot be self-served in production until Resend is connected | Add `RESEND_API_KEY` after DNS verification |
| L2 | Authentication is self-hosted (sessions, argon2id, TOTP) rather than a managed provider | Meets the release's needs; no SSO, passkeys or SMS | Revisit after the security review; module boundary allows replacement |
| L3 | Proposals, cases, tasks, documents, client portal, knowledge, AI, finance, communications and automation are not built | Navigation lists them as not yet released | Releases 2–6 |
| L4 | Service catalogue is read-only and has no fees for Nextmove Advisory | Fees can't be edited in the app yet | Release 2 adds editing with version history; Nextmove fees to be supplied |
| L5 | Custom lead fields are stored (`custom_fields`) but there's no screen to define them | Not usable yet | Release 2 |
| L6 | Duplicate detection matches exact email or normalised phone within a firm only | Name-based or cross-firm duplicates aren't flagged on leads (Hub intake checks the last 30 days across the Hub) | Add fuzzy matching with migration utilities |
| L7 | Throttling and rate limits are database-based | Fine at current volume; not a DDoS defence | Edge rate limiting on the hosting platform |
| L8 | CSP allows inline scripts | Weaker XSS defence-in-depth | Nonce-based CSP |
| L9 | Timeline and audit pages show the latest 200 / 100 entries | Older entries need "Older entries" paging (audit) or aren't listed (timeline) | Paging when volumes justify it |
| L10 | Mobile layouts scroll tables sideways | Usable but not ideal on phones | Card layouts for leads and clients on small screens |
| L12 | No backups, monitoring or error tracking are configured (no hosting yet) | Not ready for real client data | Deployment checklist |
| L13 | Privacy compliance (POPIA, Australian Privacy Act, GDPR) not legally reviewed | Must be reviewed before live use | Legal review; data-residency decision |
| L14 | The Hub logo is a placeholder monogram | Visual only | Add the official logo file |
| L15 | Row-level security relies on per-transaction settings that the application sets itself | A compromised application role could widen its own scope; the database protects against application bugs, not against a stolen app connection | Accepted design assumption; keep the app credential tightly held |
| L16 | The organisation audit log (group `audit:view`) lists event summaries for all firms, including firms that don't share metrics | Summaries use references, not names, but reveal activity volume | Decide with the firms; filter by firm policy if required |
| L17 | A few same-firm links (assigned user, department, routed lead) are enforced in the application, not by database keys | Low risk; services validate them | Add constraints when those tables next change |
