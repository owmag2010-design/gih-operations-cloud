# Known Limitations Register

Updated 21 Oct 2026, end of Release 1. Nothing here is hidden behind the interface: unbuilt modules are labelled "not yet released".

| # | Limitation | Impact | Plan |
|---|---|---|---|
| L1 | Email sends only once `RESEND_API_KEY` is set; until then messages are saved as "Not sent". Invitations still show a one-time link. Firm emails send from @thegih.com addresses until each firm's own domain is verified in Resend | Clients see thegih.com sender addresses for firm mail | Verify veritasemigrate.com, mimshacgroup.com and Nextmove's domain in Resend, then change each mailbox's "Send from" |
| L2 | Authentication is self-hosted (sessions, argon2id, TOTP) rather than a managed provider | Meets the release's needs; no SSO, passkeys or SMS | Revisit after the security review; module boundary allows replacement |
| L3 | Cases, tasks, documents, client portal, knowledge, AI, finance, communications and automation are not built | Navigation lists them as not yet released | Releases 2–6 |
| L4 | Nextmove Advisory has no fees in its catalogue | Nextmove proposals need custom items | Supply Nextmove's fee schedule |
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
| L18 | Received email attachments are listed but not downloadable in the app | Staff open them from the original mailbox | Download through Resend into document storage (Release 4) |
| L19 | Proposal PDFs use each firm's colours and layout but not yet the approved photo-led designs (hero photos, portrait) | Less polished than the hand-built proposals | Port the approved designs and photo library |
| L20 | Proposals have no AI first draft and no online deposit payment | Drafting and payment are manual | Anthropic API key; Stripe payment links |
| L21 | Accepting a proposal does not convert the lead automatically | A consultant converts the lead after the deposit | Convert on deposit once payments are connected |
| L22 | Inbound mail from a thread tag is trusted to identify the conversation | A sender who learns a tagged address could post into that conversation | Acceptable: the tag is a random 128-bit id; messages show the real sender |
| L23 | A proposal's author may also approve it (recorded in the audit log as self-approval) | No enforced four-eyes check | Add a firm policy to require a different approver once teams grow |
| L24 | New Hub email senders are recorded without contact consent; staff confirm consent when routing | Consent must be captured manually | Add a consent prompt in Hub intake |
