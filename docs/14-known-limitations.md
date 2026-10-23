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

## Added 24 Oct 2026 (milestone 1: email workspace)

| # | Limitation | Impact | Plan |
|---|---|---|---|
| L25 | Microsoft 365 and Gmail connections need one-time app registrations (Azure / Google Cloud) and their secrets in Vercel | Until then the Connect buttons say "not set up"; mail arrives only by forwarding | Owen registers the apps (see 10-deployment.md) |
| L26 | Mailbox sync is pull-based: every 5 minutes by Vercel Cron (needs `CRON_SECRET`) and on "Sync now". No Graph subscriptions or Gmail push yet | New mail can take up to 5 minutes to appear; without `CRON_SECRET` only "Sync now" syncs | Add push notifications with renewal once volumes justify it |
| L27 | History import covers the last 90 days of Inbox and Sent | Older mail stays in the provider | Make the window configurable per mailbox |
| L28 | Deleting or moving a message in Outlook/Gmail doesn't remove it here (records are kept; no silent deletion) | The dashboard can show mail since deleted in the mailbox | Show a "removed in mailbox" marker from the delta feed |
| L29 | Attachments: up to 4 MB per file when uploading (hosting request limit), 18 MB per message; files are stored in PostgreSQL | Larger files must be shared as links | Move to object storage with direct uploads (milestone 3, documents) |
| L30 | Compose is plain text with paragraphs (branded frame or plain); no rich-text editor yet | No inline formatting beyond **bold** in templates | Rich editor with the document workspace (milestone 3) |
| L31 | Microsoft 365 and Gmail report acceptance only; "Delivered" appears only for mail sent through Resend | Provider-sent mail shows "Sent via …", never "Delivered" | Provider limitation |
| L32 | Forwarding through Gmail or Resend doesn't carry the original attachments (Microsoft does) | Re-attach files when forwarding from those routes | Fetch and attach originals on forward |
| L33 | "Create task from email" waits for Tasks & Calendar | Use an internal note for now | Milestone 2 |
| L34 | Gmail's `gmail.modify` scope is "restricted": for personal Gmail accounts Google requires app verification; in testing mode refresh tokens expire after 7 days | Personal Gmail connections would need reconnecting weekly until verified | Use Google Workspace accounts (internal app) or complete verification |
| L35 | Microsoft 365 bought through GoDaddy can block third-party app consent | Connecting hello@thegih.com may need GoDaddy/Microsoft admin consent | Grant admin consent in Entra ID; if blocked, keep forwarding for that mailbox |
| L36 | Search matches subjects, people and message text with simple pattern matching | Fine at current volumes; slower at hundreds of thousands of messages | Full-text index when needed |
| L37 | "Coming up" on My day lists lead follow-ups only | Consultations, submissions and deadlines are not shown yet | Tasks & Calendar (Milestone 2) |
| L38 | Before the page hydrates, menus and dialogs opened very early use the Hub accent | Cosmetic, lasts well under a second | None needed |
