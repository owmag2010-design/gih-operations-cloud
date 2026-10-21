# Roles and Permissions

## 1. Model

```
User ──< GroupMembership >── Role (scope = group)      organisation-wide functions
User ──< FirmMembership  >── Role (scope = firm)       access to one firm's records
                 └── Firm
```

- A **permission** is a key of the form `resource:action` from a fixed catalogue in code (`src/server/access/permissions.ts`). Roles are database records holding a list of these keys, so roles are configurable without code changes.
- **Group roles never grant access to firm records.** They cover the Hub's own work: firms, staff, intake, routing, aggregate metrics and the audit log.
- **Firm records need a firm membership.** A user who works for two firms holds two memberships, each with its own role.
- Every check happens on the server, inside the service that touches the data. The interface hides actions the user lacks, but hiding is never the control.

## 2. Permission catalogue

### Group scope
| Key | Allows |
|---|---|
| `org:manage` | Organisation settings, offices |
| `firms:view` | List firms and their configuration |
| `firms:create` / `firms:edit` | Create firms; edit profile, branding, policies |
| `staff:view` | See staff accounts and memberships |
| `staff:invite` | Invite staff to the organisation or a firm |
| `staff:manage` | Change roles, deactivate users, revoke memberships and sessions |
| `roles:manage` | Create and edit roles |
| `intake:view` / `intake:create` / `intake:route` | See, capture and route Hub enquiries |
| `routing:manage` | Edit routing rules |
| `metrics:group` | Command Centre aggregates for firms that share metrics |
| `audit:view` | Organisation audit log |

### Firm scope
| Key | Allows |
|---|---|
| `firm:view` | Open the firm workspace and dashboard |
| `firm:manage` | Firm profile, pipeline stages, departments |
| `team:view` / `team:invite` / `team:manage` | Firm staff directory, invitations, role changes |
| `leads:view_all` / `leads:view_assigned` | See every lead, or only leads assigned to the user |
| `leads:create` / `leads:edit` / `leads:delete` | Manage leads |
| `leads:assign` | Assign and bulk-assign |
| `leads:convert` | Convert a lead into a client |
| `leads:export` | Export lead data (CSV) |
| `clients:view_all` / `clients:view_assigned` | See clients |
| `clients:create` / `clients:edit` / `clients:export` | Manage clients |
| `metrics:firm` | Firm dashboard numbers |
| `audit:firm` | Firm audit log |

## 3. Default roles (seeded, editable)

| Role | Scope | Permissions |
|---|---|---|
| Group Super Administrator | group | all group permissions |
| Group Operations Administrator | group | `firms:view`, `staff:view`, `intake:*`, `metrics:group`, `audit:view` |
| Firm Administrator | firm | all firm permissions |
| Immigration Consultant | firm | `firm:view`, `team:view`, `leads:view_all`, `leads:create`, `leads:edit`, `leads:assign`, `leads:convert`, `clients:view_all`, `clients:create`, `clients:edit`, `metrics:firm` |
| Case Manager | firm | `firm:view`, `team:view`, `leads:view_all`, `leads:edit`, `clients:view_all`, `clients:edit`, `metrics:firm` |
| Reviewer | firm | `firm:view`, `leads:view_all`, `clients:view_all` |
| Document Officer | firm | `firm:view`, `clients:view_all` |
| Finance Officer | firm | `firm:view`, `clients:view_all`, `metrics:firm` |
| Support Officer | firm | `firm:view`, `leads:view_assigned`, `leads:create`, `clients:view_assigned` |
| Client | portal | none in the staff app (Release 4 portal) |

## 4. Rules that stop privilege escalation

1. **Subset rule.** A user may grant a role only if every permission in it is one they already hold in the same scope (and the same firm).
2. **No self-elevation.** Users cannot change their own role or add memberships to themselves, with one audited exception below.
3. **Group access to a firm.** A Group Super Administrator can add themselves to a firm only when that firm's policy `allowGroupAdminAccess` is on. The creator of a new firm becomes its first Firm Administrator. Both are written to the audit log.
4. **Last administrator.** The last active Firm Administrator of a firm cannot be removed or downgraded.
5. **Revocation is immediate.** Memberships and permissions are read fresh on every request; deactivating a user also deletes their sessions.

## 5. Aggregate metrics across firms

The Command Centre shows a firm's figures to group users only when that firm's policy `shareAggregateMetrics` is on, or the user is a member of the firm. Aggregates are counts; they never include names or enquiry text.

## 6. Where it is enforced

| Layer | What it checks |
|---|---|
| `requireStaff()` | Valid session, MFA satisfied, active user |
| Service guard `ctx.require('leads:edit', firmId)` | Permission held in that firm |
| Query scoping | `firm_id = ANY(ctx.firmIds)`, plus `assigned_to = user` for `view_assigned` |
| PostgreSQL RLS | Row's `firm_id` is in `app.firm_ids` for the transaction |
