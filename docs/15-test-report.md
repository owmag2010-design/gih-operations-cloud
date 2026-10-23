# Test Report: Release 1

Date: 21 Oct 2026. Environment: PostgreSQL 16.15, Node 22, Next.js 16.4.2, Chromium (headless).

## Results
| Suite | Command | Result |
|---|---|---|
| Unit and integration (real database, app role with row-level security) | `npm test` | **42 passed** |
| End-to-end, production build in a browser | `npm run test:e2e` | **7 passed** |
| Type check | `npm run typecheck` | Clean |
| Lint | `npm run lint` | Clean |
| Accessibility (axe, WCAG 2 A/AA) on sign-in, dashboard, leads, new lead, clients | part of e2e | No serious or critical violations |

## What the tests cover
| Area | Tests |
|---|---|
| Firm isolation | Wrong-firm reads, writes and id swaps; unscoped queries return nothing; database refuses cross-firm inserts and cross-firm stage links; search never crosses firms; URL tampering in the browser returns 404 |
| Authorisation | Subset rule on invitations and role changes; no self-elevation; last-admin protection; each mutation checks its own permission; group roles get no firm records; Hub administrators only enter firms that allow it; invitations re-checked at acceptance; assigned-only roles limited in lists, records, clients and tags |
| Revocation | Removed membership and deactivated user lose access on the next request; sessions deleted |
| Authentication | Invitation acceptance once only; password policy; throttling, including 12 parallel guesses; no account enumeration; reset link single-use and ends all sessions; session absolute expiry; MFA secret encrypted; TOTP replay refused, including two simultaneous submissions; recovery codes single-use |
| CRM | References, phone normalisation, consent, duplicate detection, stage rules, conversion exactly once under concurrency, timeline, filters, search escaping, CSV formula neutralisation, export audited |
| Intake | Default routing suggestions for legal, Zimbabwe, investment, catch-all, asylum, Australia and empty enquiries; webhook idempotency (with and without a sender id); routing creates the lead without granting the router access; rules editable only by routing managers |
| Webhook | Signature, staleness, tampering, missing headers, oversized body, validation errors |
| Fee schedule | All 46 services parse, line items reconcile with totals, deposit and consultation rules, add-ons kept out of totals |

## Manual walk-through
A browser walk-through on the production build with labelled demo data covered: password set-up from the bootstrap link, forced two-step set-up for an administrator, six signed webhook enquiries (one duplicate, one bad signature), routing all suggested enquiries, the lead table, board, calendar and record, adding a note, changing stage, converting to a client, the command palette, and the mobile layout. No browser console errors.

## Independent security review
A separate reviewer, who had not seen the work being built, examined the code and database. Firm isolation held on every path traced. Findings and their resolution:

| Finding | Severity | Resolution |
|---|---|---|
| H1 Hub `staff:manage` could place people in any firm regardless of the firm's policy | High | **Fixed.** Hub administrators act in a firm's team only when that firm allows Hub access; otherwise the subset rule inside the firm applies. Tests added |
| M1 Throttling raced under parallel requests | Medium | **Fixed.** Attempts are reserved under a per-account lock before checking. Test with 12 parallel guesses |
| M2 Per-IP limits trusted a client-supplied header | Medium | **Fixed.** Platform header first, otherwise the right-most forwarded entry; per-address limit on reset requests |
| M3 Webhook read the whole body before the size check | Medium | **Fixed.** `Content-Length` checked and the body read with a cap. Test added |
| L1 Definer functions could be shadowed by temporary tables | Low | **Fixed.** Safe `search_path`, qualified names, temporary tables revoked from the app role (migration 0005) |
| L2 Row-level security trusts settings the app sets | Low | **Accepted** as a design assumption; documented in the architecture |
| L3 A session that had not passed two-step could accept an invitation | Low | **Fixed** |
| L4 TOTP replay check not atomic | Low | **Fixed.** Conditional update. Test added |
| L5 Weak re-authentication for account security changes | Low | **Fixed.** Turning two-step off needs password and a code; checks throttled; turning it on signs out other sessions |
| L6 Assigned-only users saw every tag in the firm | Low | **Fixed.** Test added |
| L7 Personal data in audit records and logs | Low | **Fixed.** Search text and notes kept out of audit data; webhook logs error type only |
| L8 Reset timing revealed whether an account exists | Low | **Fixed.** Reset work runs after the response |
| L9 Webhook replays without a sender id duplicated enquiries | Low | **Fixed.** The signature serves as the id. Test added |
| L10 CSP allows inline scripts | Low | **Open**, known limitation L8 |
| Informational: org audit log shows summaries for firms not sharing metrics; some same-firm references enforced only in the app; group invitation replaces an existing group role | Info | Recorded in the known-limitations register |

## 23 Oct 2026: Hub branding, email, proposals
- 74 unit and integration tests pass; 7 end-to-end tests with accessibility checks pass; production build passes.
- Independent security review of the new code: no High findings. Fixed: forged email could be filed into a client's conversation (M1); proposals and email ignored assigned-only lead visibility (M2); Hub template preview lacked a permission check (L1); Hub email rows not tied to their thread's firm in the database (L2, trigger); formatted received email could load remote images (L3, frame CSP); withdrawn proposals couldn't be re-sent; oversized amounts; unchecked service id; In-Reply-To header format; reserved firm slugs. Also found and fixed during testing: two correlated subqueries that compared the wrong id column (inbox previews, catalogue version numbers). Each has a regression test.
