# Application Navigation Map

Items appear only when the signed-in person's permissions allow them. Unreleased modules are listed under "Not yet released" in the sidebar with their release number; they are never shown as working screens.

## Public
| Path | Screen |
|---|---|
| `/login` | Sign in |
| `/login/mfa` | Two-step code |
| `/reset-password`, `/reset-password/[token]` | Request and set a new password |
| `/invite/[token]` | Accept an invitation |
| `/api/intake/webhook` | Signed enquiry intake (machines) |
| `/api/health` | Uptime check |

## Hub headquarters (`/hq`)
| Path | Screen | Needs |
|---|---|---|
| `/hq` | Command Centre | `metrics:group` |
| `/hq/intake` | Intake queue (waiting, routed, closed, all) | `intake:view` |
| `/hq/intake/new` | Capture an enquiry | `intake:create` |
| `/hq/intake/[id]` | Enquiry, routing suggestion, route/hold/close | `intake:view`, `intake:route` to act |
| `/hq/routing` | Routing rules and a rule tester | `routing:manage` to edit |
| `/hq/firms`, `/hq/firms/new` | Firms; add a firm; join a firm (if its policy allows) | `firms:view`, `firms:create` |
| `/hq/people` | Staff, group roles, firm memberships, invitations, deactivation | `staff:view`, `staff:manage` |
| `/hq/audit` | Organisation audit log | `audit:view` |

Release 2–6 entries (Proposals, Cases, Documents, Knowledge Centre, Communications, Finance, Automation Studio, Analytics) are listed as not yet released.

## Firm workspace (`/f/[firm]`)
| Path | Screen | Needs |
|---|---|---|
| `/f/[firm]` | Firm dashboard | `metrics:firm` (others see a short notice) |
| `/f/[firm]/leads` | Leads: table, board, follow-up calendar, filters, saved views, bulk actions | `leads:view_*` |
| `/f/[firm]/leads/new` | New lead | `leads:create` |
| `/f/[firm]/leads/[id]`, `/edit` | Lead record, notes, consent, duplicates, conversion | `leads:view_*`, `leads:edit`, `leads:convert` |
| `/f/[firm]/leads/export` | CSV export | `leads:export` |
| `/f/[firm]/clients`, `/new`, `/[id]`, `/[id]/edit`, `/export` | Clients | `clients:*` |
| `/f/[firm]/team` | Team, roles, invitations | `team:view` |
| `/f/[firm]/settings` | Profile, data-sharing and security policies, pipeline, offices, departments, fee catalogue | `firm:view`, `firm:manage` to edit |
| `/f/[firm]/audit` | Firm audit log | `audit:firm` |

## Everywhere
- `/account`: two-step sign-in, password, active sessions, the person's access.
- Workspace switcher (top of sidebar) lists only workspaces the person may open.
- Command palette: `Ctrl K` / `⌘K` or `/`. Searches leads, clients and Hub enquiries the person can see, and jumps to pages.
