# API Reference

Staff screens use Next.js server actions (re-authorised on every call). Machine callers use the route handlers below.

## POST `/api/intake/webhook`
Creates a Hub intake item and attaches a routing suggestion. Idempotent on `(source, sourceRef)`.

### Signing
```
X-GIH-Timestamp: <unix seconds>
X-GIH-Signature: hex(HMAC_SHA256(INTAKE_WEBHOOK_SECRET, "<timestamp>.<raw body>"))
```
Requests older or newer than 5 minutes are refused. A `sha256=` prefix on the signature is accepted.

Node example:
```js
const body = JSON.stringify(payload);
const ts = String(Math.floor(Date.now() / 1000));
const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
await fetch(`${APP_URL}/api/intake/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-gih-timestamp": ts, "x-gih-signature": sig }, body });
```

### Body (JSON, max 64 KB)
| Field | Type | Notes |
|---|---|---|
| `firstName` | string, required | |
| `lastName` | string | |
| `email` / `phone` | string | At least one is required. Phones are normalised to E.164 |
| `nationality`, `currentCountry`, `destinationCountry` | ISO 3166 alpha-2 | e.g. `ZW` |
| `immigrationCategory` | string | |
| `enquiry` | string, ≤ 5,000 | Read by the routing rules |
| `source` | `website_form` \| `assessment_form` \| `email` \| `whatsapp` \| `referral` \| `integration` | |
| `sourceRef` | string | Sender's own id. Strongly recommended |
| `consentContact` | boolean | The person agreed to be contacted |

### Responses
| Status | Body |
|---|---|
| 201 | `{ id, created: true, status: "new" \| "held", routingSuggested, flags }` |
| 200 | Same, `created: false` (already received) |
| 401 | `{ error: "invalid_signature", reason: "missing" \| "stale" \| "mismatch" }` |
| 413 | Payload too large |
| 422 | `{ error: "validation_failed", fields: { field: message } }` |

Responses never echo personal information.

## GET `/api/health`
`200 {"status":"ok"}` when the database is reachable, otherwise `503`.

## CSV exports (signed-in staff)
`GET /f/[firm]/leads/export?<lead filters>` and `GET /f/[firm]/clients/export?status=` return UTF-8 CSV. Each export is written to the audit log with its row count. Values starting with `= + - @` are prefixed with `'` to stop spreadsheet formula injection.
