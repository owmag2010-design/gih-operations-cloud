/**
 * Permission catalogue. Roles in the database hold lists of these keys.
 * See docs/04-roles-and-permissions.md.
 */

export const GROUP_PERMISSIONS = [
  "org:manage",
  "firms:view",
  "firms:create",
  "firms:edit",
  "staff:view",
  "staff:invite",
  "staff:manage",
  "roles:manage",
  "intake:view",
  "intake:create",
  "intake:route",
  "routing:manage",
  "metrics:group",
  "audit:view",
  "hub_email:send",
  "hub_templates:manage",
  "mailboxes:manage",
  "mirror:view",
  "mirror:manage",
] as const;

export const FIRM_PERMISSIONS = [
  "firm:view",
  "firm:manage",
  "team:view",
  "team:invite",
  "team:manage",
  "leads:view_all",
  "leads:view_assigned",
  "leads:create",
  "leads:edit",
  "leads:delete",
  "leads:assign",
  "leads:convert",
  "leads:export",
  "clients:view_all",
  "clients:view_assigned",
  "clients:create",
  "clients:edit",
  "clients:export",
  "matters:view_all",
  "matters:view_assigned",
  "matters:create",
  "matters:edit",
  "tasks:view_team",
  "invoices:view",
  "invoices:edit",
  "invoices:issue",
  "payments:verify",
  "metrics:firm",
  "audit:firm",
  "services:manage",
  "proposals:view",
  "proposals:create",
  "proposals:edit",
  "proposals:approve",
  "proposals:release",
  "email:view",
  "email:send",
  "templates:manage",
] as const;

export type GroupPermission = (typeof GROUP_PERMISSIONS)[number];
export type FirmPermission = (typeof FIRM_PERMISSIONS)[number];
export type Permission = GroupPermission | FirmPermission;

export const PERMISSION_LABELS: Record<Permission, string> = {
  "org:manage": "Manage organisation settings and offices",
  "firms:view": "View firms",
  "firms:create": "Create firms",
  "firms:edit": "Edit firm profiles and policies",
  "staff:view": "View staff",
  "staff:invite": "Invite staff",
  "staff:manage": "Manage staff roles and access",
  "roles:manage": "Manage roles",
  "intake:view": "View Hub intake",
  "intake:create": "Capture Hub enquiries",
  "intake:route": "Route Hub enquiries to firms",
  "routing:manage": "Manage routing rules",
  "metrics:group": "View group metrics",
  "audit:view": "View organisation audit log",
  "hub_email:send": "Send and reply from the Hub inbox",
  "hub_templates:manage": "Manage the Hub's shared email templates",
  "mailboxes:manage": "Manage inbound mailboxes and sending addresses",
  "mirror:view": "View the Hub's Airtable data in the mirror",
  "mirror:manage": "Manage the Airtable mirror: tables, syncs and reconciliation",
  "firm:view": "Open the firm workspace",
  "firm:manage": "Manage firm settings and pipeline",
  "team:view": "View firm team",
  "team:invite": "Invite to the firm",
  "team:manage": "Manage firm team roles",
  "leads:view_all": "View all leads",
  "leads:view_assigned": "View assigned leads only",
  "leads:create": "Create leads",
  "leads:edit": "Edit leads",
  "leads:delete": "Delete leads",
  "leads:assign": "Assign leads",
  "leads:convert": "Convert leads to clients",
  "leads:export": "Export leads",
  "clients:view_all": "View all clients",
  "clients:view_assigned": "View assigned clients only",
  "clients:create": "Create clients",
  "clients:edit": "Edit clients",
  "clients:export": "Export clients",
  "matters:view_all": "View all matters (restricted matters only when on the team)",
  "matters:view_assigned": "View matters they are on the team for",
  "matters:create": "Open matters",
  "matters:edit": "Edit matters, people, facts and dates",
  "tasks:view_team": "See the practice's team tasks and everyone's assigned tasks",
  "invoices:view": "View invoices, payments and finance reports",
  "invoices:edit": "Prepare draft invoices",
  "invoices:issue": "Issue, void and credit invoices; change billing settings",
  "payments:verify": "Record and verify payments",
  "metrics:firm": "View firm metrics",
  "audit:firm": "View firm audit log",
  "services:manage": "Edit services and fees",
  "proposals:view": "View proposals",
  "proposals:create": "Create proposals",
  "proposals:edit": "Edit draft proposals",
  "proposals:approve": "Approve proposals",
  "proposals:release": "Send proposals to clients",
  "email:view": "Read the firm inbox and email history",
  "email:send": "Send emails to leads and clients",
  "templates:manage": "Manage the firm's email templates",
};

export function isGroupPermission(p: string): p is GroupPermission {
  return (GROUP_PERMISSIONS as readonly string[]).includes(p);
}
export function isFirmPermission(p: string): p is FirmPermission {
  return (FIRM_PERMISSIONS as readonly string[]).includes(p);
}

type RoleDef = { key: string; name: string; scope: "group" | "firm" | "portal"; description: string; permissions: Permission[] };

export const DEFAULT_ROLES: RoleDef[] = [
  {
    key: "group_super_admin",
    name: "Group Super Administrator",
    scope: "group",
    description: "Runs the Hub: firms, staff, routing, intake, metrics and audit. Sees firm records only through a firm membership.",
    permissions: [...GROUP_PERMISSIONS],
  },
  {
    key: "group_ops_admin",
    name: "Group Operations Administrator",
    scope: "group",
    description: "Triages Hub enquiries and watches group metrics.",
    permissions: ["firms:view", "staff:view", "intake:view", "intake:create", "intake:route", "metrics:group", "audit:view", "hub_email:send", "mirror:view"],
  },
  {
    key: "firm_admin",
    name: "Firm Administrator",
    scope: "firm",
    description: "Full control of one firm's workspace, team and settings.",
    permissions: [...FIRM_PERMISSIONS],
  },
  {
    key: "immigration_consultant",
    name: "Immigration Consultant",
    scope: "firm",
    description: "Works leads through to clients.",
    permissions: [
      "firm:view", "team:view", "leads:view_all", "leads:create", "leads:edit", "leads:assign",
      "leads:convert", "clients:view_all", "clients:create", "clients:edit", "metrics:firm",
      "proposals:view", "proposals:create", "proposals:edit", "email:view", "email:send",
      "matters:view_all", "matters:create", "matters:edit", "tasks:view_team", "invoices:view", "invoices:edit",
    ],
  },
  {
    key: "case_manager",
    name: "Case Manager",
    scope: "firm",
    description: "Manages client matters.",
    permissions: [
      "firm:view", "team:view", "leads:view_all", "leads:edit", "clients:view_all", "clients:edit", "metrics:firm", "proposals:view", "email:view", "email:send",
      "matters:view_assigned", "matters:create", "matters:edit", "tasks:view_team", "invoices:view",
    ],
  },
  {
    key: "reviewer",
    name: "Reviewer",
    scope: "firm",
    description: "Reviews work; read access.",
    permissions: ["firm:view", "leads:view_all", "clients:view_all", "proposals:view", "proposals:approve", "matters:view_all"],
  },
  {
    key: "document_officer",
    name: "Document Officer",
    scope: "firm",
    description: "Handles client documents (Release 4).",
    permissions: ["firm:view", "clients:view_all", "matters:view_assigned"],
  },
  {
    key: "finance_officer",
    name: "Finance Officer",
    scope: "firm",
    description: "Billing, payments and the fee schedule.",
    permissions: ["firm:view", "clients:view_all", "metrics:firm", "services:manage", "proposals:view", "matters:view_all", "invoices:view", "invoices:edit", "invoices:issue", "payments:verify"],
  },
  {
    key: "support_officer",
    name: "Support Officer",
    scope: "firm",
    description: "Captures enquiries and supports assigned records.",
    permissions: ["firm:view", "leads:view_assigned", "leads:create", "clients:view_assigned", "matters:view_assigned"],
  },
  {
    key: "client",
    name: "Client",
    scope: "portal",
    description: "Client portal user (Release 4). No staff access.",
    permissions: [],
  },
];

/** Roles that must have MFA regardless of firm policy. */
export const MFA_MANDATORY_ROLE_KEYS = new Set(["group_super_admin", "group_ops_admin", "firm_admin"]);
