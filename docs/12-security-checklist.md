# Security and Privacy Checklist

Status as of Release 1. "Done" means implemented and covered by a test or a manual check recorded here.

## Access control
| Control | Status |
|---|---|
| Server-side permission checks in every service | Done (integration tests) |
| Firm isolation in services | Done |
| Firm isolation in PostgreSQL row-level security, default deny | Done (tests probe the database directly) |
| Cross-firm foreign keys | Done |
| Group roles grant no firm record access | Done |
| Subset rule, no self-elevation, last-admin protection | Done |
| URL and id tampering returns 404 | Done (e2e) |
| Assigned-only roles limited in lists, search, exports and dashboards | Done |

## Authentication
| Control | Status |
|---|---|
| argon2id password hashing (OWASP parameters) | Done |
| 12-character minimum, common-password and email checks | Done |
| Server-side sessions, hashed tokens, idle 12 h / absolute 7 days | Done |
| `HttpOnly`, `Secure` (production), `SameSite=Lax`, `__Host-` cookie | Done |
| TOTP two-step sign-in; mandatory for admin roles; firm option for everyone | Done |
| TOTP replay protection; single-use recovery codes stored hashed | Done |
| MFA secret encrypted at rest (AES-256-GCM) | Done |
| Sign-in, MFA, reset and password-change throttling, race-safe, per account and per IP | Done |
| No account enumeration on sign-in and reset | Done |
| Invitation and reset links single-use, expiring, stored hashed | Done |
| Deactivation ends all sessions immediately | Done |

## Application
| Control | Status |
|---|---|
| Content Security Policy, frame denial, nosniff, referrer and permissions policies, HSTS | Done (e2e checks headers) |
| Input validation with Zod on every mutation | Done |
| CSV formula-injection protection | Done |
| Signed, time-limited, idempotent webhook with size limit | Done |
| Append-only audit log for sign-in, access, routing, record changes and exports | Done |
| Errors shown to users carry no internal detail | Done |

## Not yet done (tracked in the known-limitations register)
- CSP still allows `'unsafe-inline'` scripts (Next.js inline runtime); move to nonces
- Rate limiting is database-based; add an edge rate limiter in production
- An independent security review was completed on 21 Oct 2026; all high and medium findings are fixed (see the test report)
- No malware scanning or file storage yet (Release 4)
- No automated backup/restore drill yet
- Re-authentication is required for turning off two-step sign-in and changing the password; other sensitive actions (role changes, exports) don't yet ask again
- Security monitoring and alerting not yet connected

## Privacy (POPIA, Australian Privacy Act, GDPR where relevant)
These need legal review; the system does not claim automatic compliance.
- Consent recorded per lead and client, with method and evidence
- Data minimisation: aggregates only across firms; audit summaries use references, not names
- Retention: soft delete only so far; retention periods and hard-deletion jobs to be set per firm
- Cross-border transfer: the Hub is headquartered in Australia, firms in South Africa and Zimbabwe; the database region and operator agreements must be confirmed before live use
- Data-subject requests (access, correction, deletion): manual for now; tooling planned
