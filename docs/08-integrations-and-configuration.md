# Integrations, Credentials and Configuration

## Environment variables
Copy `.env.example` to `.env.local` (development) or set them in the hosting platform (production).

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Application connection, as the restricted `gih_app` role |
| `MIGRATION_DATABASE_URL` | For migrations/seed | Schema owner connection. Not given to the running app |
| `APP_URL` | Yes | Public base URL, used in invitation and reset links |
| `DATA_ENCRYPTION_KEY` | Yes | 32 bytes, base64. Encrypts MFA secrets. `openssl rand -base64 32`. Rotating it requires re-enrolling MFA |
| `INTAKE_WEBHOOK_SECRET` | Yes | Shared secret for signed intake webhooks. `openssl rand -hex 32` |
| `RESEND_API_KEY` | No | When empty, emails are recorded as "not configured" and nothing is sent |
| `EMAIL_FROM` | No | Sender, default `Global Immigration Hub <hello@thegih.com>` |

## Status of each integration

| Integration | Release 1 status | What's needed |
|---|---|---|
| PostgreSQL | **Working** | Managed instance in the chosen region; `gih_app` role |
| Resend (transactional email) | **Adapter built, not connected** | API key; `thegih.com` DNS records verified in Resend (already started in the automation project) |
| Intake webhook (Tally, website form, WhatsApp bot) | **Working** | Each sender signs requests; see `09-api.md`. Tally needs a small relay (Make or a Cloudflare Worker) because Tally cannot compute this signature itself |
| Stripe | Planned (Release 2) | Decision on which Stripe account(s) each firm uses; keys per firm |
| Anthropic Claude API | Planned (Release 2/5) | API key, data-processing settings |
| Object storage (documents) | Planned (Release 4) | S3-compatible bucket (R2 or S3) in the chosen region |
| Microsoft 365 (Graph) | Planned (Release 6) | App registration per tenant (Veritas, Nextmove) |
| WhatsApp Business (Infobip) | Planned (Release 6) | Existing Infobip sender and approved templates |
| Sentry | Planned | DSN once hosting is chosen |
| Managed identity provider | Optional | Only if chosen over the built-in auth |

Nothing above is described as working unless it has been exercised end to end. The email adapter, for example, has been tested only in "not configured" mode.

## Connecting the existing intake
The current Airtable/Cloudflare `gih-engine` triage can forward each new enquiry to `POST /api/intake/webhook` with the fields in `09-api.md`. Use the Tally submission id (or WhatsApp message id) as `sourceRef` so retries never create duplicates.
