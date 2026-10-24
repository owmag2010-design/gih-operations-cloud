import type { AccessContext } from "@/server/access/context";

/**
 * Navigation: the same eleven workspaces in the Hub and in every practice, so
 * people always find things in the same place. Secondary screens live inside
 * a workspace (tabs), not in the sidebar. Workspaces that aren't built yet say
 * so and when they arrive.
 */

export type IconName =
  | "gauge" | "inbox" | "route" | "building" | "users" | "scroll" | "contact" | "user-round" | "settings" | "layout" | "file-text"
  | "mail" | "templates" | "at-sign" | "calendar" | "folder" | "wallet" | "book" | "megaphone" | "chart" | "sunrise";

export type NavItem = { label: string; href: string; icon: IconName; exact?: boolean; soon?: string; match?: string[]; badge?: number; /** What the badge counts, for screen readers (default "unread"). */ badgeLabel?: string; /** Label in the top bar. */ short?: string };
/** Kept for compatibility with older layouts; the new navigation lists everything. */
export type FutureItem = { label: string; release: number };

export type Workspace = { kind: "hq" } | { kind: "firm"; slug: string; name: string; color: string };

export const MODULES = {
  tasks: { title: "Tasks & Calendar", milestone: 2, summary: "Personal, team and matter tasks with owners, due dates, reminders and recurring options; task templates by service and stage; calendar views for consultations, appointments, submissions, document expiry and deadlines; connected calendars." },
  matters: { title: "Clients & Matters", milestone: 2, summary: "Matters under each client: applicants and dependants, service and legal category, status and expiry dates, checklists and documents, deadlines with their basis, fees, submission details and history. Verified facts kept apart from client statements and staff assessments." },
  documents: { title: "Documents", milestone: 3, summary: "Drafting in the dashboard: client letters, representations, consultation reports, roadmaps and submission packs from branded templates, with version history, review and approval, DOCX and PDF export, and scanned uploads with OCR." },
  finance: { title: "Proposals & Finance", milestone: 3, summary: "Invoices with numbering per entity, payment schedules, verified payment reconciliation, and operational reports of billed, received and outstanding amounts per practice. Proposals already work in each practice." },
  knowledge: { title: "Knowledge & Updates", milestone: 4, summary: "A South African immigration library (Acts, regulations, Gazettes, DHA directives, judgments, VFS requirements) with status down to provision level, plus Zimbabwe developments; and a monitor of official sources with review before anything is published internally." },
  content: { title: "Content", milestone: 4, summary: "Articles, updates, FAQs and resource pages for the Hub and practice websites, with review, scheduling and publishing only to a connected website." },
  reports: { title: "Reports", milestone: 3, summary: "Workload, pipeline, conversion and finance reports per practice and across the group. Today: the Command Centre figures and the audit log." },
  chat: { title: "Team chat", milestone: 4, summary: "Direct messages, practice channels and matter discussions, kept separate from client messaging." },
} as const;
export type ModuleKey = keyof typeof MODULES;

const soon = (k: ModuleKey) => `/soon/${k}`;

export function hqNav(ctx: AccessContext, opts: { unread?: number; tasksDue?: number } = {}): NavItem[] {
  const items: NavItem[] = [{ label: "My day", href: "/today", icon: "sunrise", exact: true }];
  if (ctx.has("metrics:group")) items.push({ label: "Command Centre", short: "Command Centre", href: "/hq", icon: "gauge", exact: true });
  const anyInbox = ctx.has("intake:view") || [...ctx.firms.values()].some((f) => f.permissions.has("email:view"));
  if (anyInbox) items.push({ label: "Inbox", href: "/inbox", icon: "inbox", badge: opts.unread });
  if (ctx.has("intake:view")) items.push({ label: "Enquiries & Deals", short: "Enquiries", href: "/hq/intake", icon: "contact", match: ["/hq/routing"] });
  const matterFirms = [...ctx.firms.values()].filter((f) => f.permissions.has("matters:view_all") || f.permissions.has("matters:view_assigned"));
  if (matterFirms.length) items.push({ label: "Clients & Matters", short: "Matters", href: "/matters", icon: "user-round", match: ["/airtable"] });
  else if (ctx.has("mirror:view") || ctx.has("mirror:manage")) items.push({ label: "Clients & Matters", short: "Records", href: "/airtable", icon: "user-round" });
  items.push({ label: "Tasks & Calendar", short: "Tasks", href: "/tasks", icon: "calendar", match: ["/calendar"], badge: opts.tasksDue, badgeLabel: "overdue" });
  if (ctx.has("hub_templates:manage") || ctx.has("intake:view")) items.push({ label: "Documents & Templates", short: "Documents", href: "/hq/templates", icon: "folder", match: ["/settings/signatures"] });
  if ([...ctx.firms.values()].some((f) => f.permissions.has("invoices:view"))) items.push({ label: "Proposals & Finance", short: "Finance", href: "/finance", icon: "wallet" });
  items.push({ label: "Knowledge & Updates", short: "Knowledge", href: soon("knowledge"), icon: "book", soon: "Milestone 4" });
  items.push({ label: "Content", href: soon("content"), icon: "megaphone", soon: "Milestone 4" });
  if (ctx.has("audit:view") || ctx.has("metrics:group")) items.push({ label: "Reports", href: "/hq/audit", icon: "chart" });
  if (ctx.has("firms:view") || ctx.has("staff:view") || ctx.has("mailboxes:manage") || ctx.has("routing:manage")) items.push({ label: "Settings", href: "/hq/settings", icon: "settings", match: ["/hq/firms", "/hq/people", "/hq/routing", "/hq/email", "/settings"] });
  return items;
}

export const HQ_FUTURE: FutureItem[] = [];

export function firmNav(ctx: AccessContext, firmId: string, slug: string, opts: { unread?: number; tasksDue?: number } = {}): NavItem[] {
  const base = `/f/${slug}`;
  const items: NavItem[] = [{ label: "My day", href: "/today", icon: "sunrise", exact: true }, { label: "Practice overview", short: "Practice", href: base, icon: "layout", exact: true }];
  if (ctx.has("email:view", firmId)) items.push({ label: "Inbox", href: `/inbox?practice=${firmId}`, icon: "inbox", match: [`${base}/inbox`], badge: opts.unread });
  if (ctx.has("leads:view_all", firmId) || ctx.has("leads:view_assigned", firmId)) items.push({ label: "Enquiries & Deals", short: "Enquiries", href: `${base}/leads`, icon: "contact" });
  if (ctx.has("clients:view_all", firmId) || ctx.has("clients:view_assigned", firmId)) items.push({ label: "Clients & Matters", short: "Clients & matters", href: `${base}/clients`, icon: "user-round", match: [`${base}/matters`, "/airtable"] });
  else if (ctx.has("matters:view_all", firmId) || ctx.has("matters:view_assigned", firmId)) items.push({ label: "Clients & Matters", short: "Matters", href: `${base}/matters`, icon: "user-round" });
  items.push({ label: "Tasks & Calendar", short: "Tasks", href: "/tasks", icon: "calendar", match: ["/calendar"], badge: opts.tasksDue, badgeLabel: "overdue" });
  if (ctx.has("email:view", firmId) || ctx.has("templates:manage", firmId)) items.push({ label: "Documents & Templates", short: "Documents", href: `${base}/templates`, icon: "folder" });
  if (ctx.has("invoices:view", firmId)) items.push({ label: "Proposals & Finance", short: "Finance", href: `${base}/finance`, icon: "wallet", match: [`${base}/proposals`] });
  else if (ctx.has("proposals:view", firmId)) items.push({ label: "Proposals & Finance", short: "Finance", href: `${base}/proposals`, icon: "wallet" });
  items.push({ label: "Knowledge & Updates", short: "Knowledge", href: soon("knowledge"), icon: "book", soon: "Milestone 4" });
  items.push({ label: "Content", href: soon("content"), icon: "megaphone", soon: "Milestone 4" });
  if (ctx.has("audit:firm", firmId)) items.push({ label: "Reports", href: `${base}/audit`, icon: "chart" });
  if (ctx.has("firm:manage", firmId) || ctx.has("firm:view", firmId)) items.push({ label: "Settings", href: `${base}/settings`, icon: "settings", match: [`${base}/team`, "/settings"] });
  return items;
}

export const FIRM_FUTURE: FutureItem[] = [];
