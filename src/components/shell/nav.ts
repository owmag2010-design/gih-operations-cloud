import type { AccessContext } from "@/server/access/context";

export type NavItem = { label: string; href: string; icon: IconName; exact?: boolean };
export type FutureItem = { label: string; release: number };
export type IconName = "gauge" | "inbox" | "route" | "building" | "users" | "scroll" | "contact" | "user-round" | "settings" | "layout" | "file-text" | "mail" | "templates" | "at-sign";

export type Workspace = { kind: "hq" } | { kind: "firm"; slug: string; name: string; color: string };

export function hqNav(ctx: AccessContext): NavItem[] {
  const items: NavItem[] = [];
  if (ctx.has("metrics:group")) items.push({ label: "Command Centre", href: "/hq", icon: "gauge", exact: true });
  if (ctx.has("intake:view")) items.push({ label: "Hub inbox", href: "/hq/inbox", icon: "mail" });
  if (ctx.has("intake:view")) items.push({ label: "Hub intake", href: "/hq/intake", icon: "inbox" });
  if (ctx.has("routing:manage") || ctx.has("intake:view")) items.push({ label: "Routing rules", href: "/hq/routing", icon: "route" });
  if (ctx.has("firms:view")) items.push({ label: "Firms", href: "/hq/firms", icon: "building" });
  if (ctx.has("staff:view")) items.push({ label: "People", href: "/hq/people", icon: "users" });
  if (ctx.has("hub_templates:manage") || ctx.has("intake:view")) items.push({ label: "Email templates", href: "/hq/templates", icon: "templates" });
  if (ctx.has("mailboxes:manage")) items.push({ label: "Email settings", href: "/hq/email", icon: "at-sign" });
  if (ctx.has("audit:view")) items.push({ label: "Audit log", href: "/hq/audit", icon: "scroll" });
  return items;
}

export const HQ_FUTURE: FutureItem[] = [
  { label: "Cases", release: 3 },
  { label: "Documents", release: 4 },
  { label: "Knowledge Centre", release: 5 },
  { label: "WhatsApp", release: 6 },
  { label: "Finance", release: 6 },
  { label: "Automation Studio", release: 6 },
  { label: "Analytics", release: 6 },
];

export function firmNav(ctx: AccessContext, firmId: string, slug: string): NavItem[] {
  const base = `/f/${slug}`;
  const items: NavItem[] = [{ label: "Dashboard", href: base, icon: "layout", exact: true }];
  if (ctx.has("email:view", firmId)) items.push({ label: "Inbox", href: `${base}/inbox`, icon: "mail" });
  if (ctx.has("leads:view_all", firmId) || ctx.has("leads:view_assigned", firmId)) items.push({ label: "Leads", href: `${base}/leads`, icon: "contact" });
  if (ctx.has("proposals:view", firmId)) items.push({ label: "Proposals", href: `${base}/proposals`, icon: "file-text" });
  if (ctx.has("clients:view_all", firmId) || ctx.has("clients:view_assigned", firmId)) items.push({ label: "Clients", href: `${base}/clients`, icon: "user-round" });
  if (ctx.has("email:view", firmId) || ctx.has("templates:manage", firmId)) items.push({ label: "Email templates", href: `${base}/templates`, icon: "templates" });
  if (ctx.has("team:view", firmId)) items.push({ label: "Team", href: `${base}/team`, icon: "users" });
  if (ctx.has("firm:manage", firmId) || ctx.has("firm:view", firmId)) items.push({ label: "Settings", href: `${base}/settings`, icon: "settings" });
  if (ctx.has("audit:firm", firmId)) items.push({ label: "Audit log", href: `${base}/audit`, icon: "scroll" });
  return items;
}

export const FIRM_FUTURE: FutureItem[] = [
  { label: "Cases", release: 3 },
  { label: "Tasks", release: 3 },
  { label: "Documents", release: 4 },
  { label: "Knowledge", release: 5 },
  { label: "WhatsApp", release: 6 },
  { label: "Billing", release: 6 },
  { label: "Reports", release: 6 },
];
