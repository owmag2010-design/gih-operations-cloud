# Client portal (Release 4, first slice)

A private page for each matter where the client follows the application from start to finish, uploads documents and messages the team. Staff run it from the **Client portal** panel on the matter page.

## What the client sees
`/portal/<private link>` (served from `PORTAL_URL`, for example `https://portal.thegih.com`).

- **Sign-in:** the link alone shows only the client's first name, the practice and a masked email. To see the matter the client asks for a six-digit code, which is emailed to the address staff entered. Codes last 15 minutes, five wrong tries lock a code, and at most five codes can be sent an hour. A correct code opens a 30-day session (a cookie scoped to `/portal`, one per link).
- **Overview:** next step (outstanding documents or "nothing needed"), current stage, documents in, latest message from the team.
- **Journey:** the matter's stages (the service's own set, or the practice default), done / now / coming up, with a plain explanation of each standard stage.
- **Documents:** the checklist staff set, grouped, with an upload button per item and a general drop zone (PDF, JPEG, PNG, HEIC, WebP, Word; up to 15 MB).
- **Messages:** the conversation with the team. Internal notes are never included.
- **Client card and help:** name, email, phone, nationality, matter, reference, practice and how to contact the team.
- Global Immigration Hub branding: navy and red, Newsreader and Instrument Sans, the Hub's licensed photographs (`public/brand/portal`).

## What staff do (matter page › Client portal)
- **Open client portal:** confirm the client's email, optionally paste the client's Google Drive folder link, and email the invitation. The link can be copied at any time; **Replace link** issues a new one and ends every session on the old one; **Close portal** stops it.
- **Document checklist:** add documents one per line (`Group: Document` to group them); set each to Needed, Received, Accepted or Not needed. A client upload against an item marks it Received.
- **Messages:** reply (the client is emailed a short notice with a link; the message itself stays in the portal) or tick **Internal note** (team only).
- **Client uploads:** each upload is stored with the matter's files (same place as staff uploads, so OCR and the documents workspace apply) and, when a Drive folder is set and Drive is connected, copied into the client's Google Drive folder as `YYYY-MM-DD <checklist item> - <file name>`. Failed copies can be retried.

## Alerts
Every client message or upload emails the matter team (case manager, consultant and added members), the practice inbox (`firms.contact_email`) and every address in `PORTAL_ALERT_COPY`, with a link to the matter. With `SLACK_PORTAL_WEBHOOK_URL` set, the same alert goes to Slack.

## Security
- Only SHA-256 hashes of the link, codes and sessions are stored. The link is also kept encrypted (`DATA_ENCRYPTION_KEY`) so staff can copy it again.
- Client reads and writes go only through `portal_*` SECURITY DEFINER functions keyed by the session hash; each touches one matter. `portal_codes` and `portal_sessions` have no grants for the app role.
- Staff access uses the normal services: firm row-level security, restricted matters stay hidden from people off the team, and changes need `matters:edit`.
- Uploads go to a route handler (not a server action, which is capped at 1 MB); the session cookie is SameSite=Lax and the Origin is checked.

## Setting it up (Owen)
1. **Domain:** add `portal.thegih.com` to the Vercel project (CNAME `portal` → `cname.vercel-dns.com` in GoDaddy) and set `PORTAL_URL=https://portal.thegih.com`.
2. **Google Drive (service account):**
   1. Google Cloud console › create (or pick) a project › APIs & Services › enable **Google Drive API**.
   2. IAM & Admin › Service accounts › Create service account, name it `gih-portal`. No roles are needed.
   3. Open it › Keys › Add key › JSON. Paste the whole file into `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel.
   4. Share each client's Drive folder (or, better, the parent "clients" folder or shared drive) with the service account's address (`gih-portal@<project>.iam.gserviceaccount.com`) as **Editor**.
3. **Alerts:** set `PORTAL_ALERT_COPY=owmag2010@gmail.com`. Optional: create a Slack incoming webhook for the alerts channel and set `SLACK_PORTAL_WEBHOOK_URL`.
4. Make sure each practice has its inbox in Settings (`contact_email`, e.g. `cs@veritasemigrate.com`).
5. Email is already sent through Resend (`RESEND_API_KEY`).
