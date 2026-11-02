"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import {
  AtSign,
  BookOpen,
  Building2,
  CalendarDays,
  ChartColumn,
  Check,
  Contact,
  FileText,
  FolderOpen,
  Gauge,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  MessagesSquare,
  ChevronsUpDown,
  Monitor,
  Moon,
  Plus,
  Route,
  ScrollText,
  Settings,
  Sun,
  Sunrise,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { setThemeAction } from "@/app/(staff)/shell-actions";
import { HubMark } from "../hub-mark";
import { cn } from "../ui/primitives";
import type { WorkspaceOption } from "./app-shell";
import type { IconName, NavItem } from "./nav";

export type UiTheme = "dark" | "light" | "system";

const ICONS: Record<IconName, React.ComponentType<{ className?: string }>> = {
  gauge: Gauge, inbox: Inbox, route: Route, building: Building2, users: Users, scroll: ScrollText,
  contact: Contact, "user-round": UserRound, settings: Settings, layout: LayoutDashboard, "file-text": FileText, mail: Mail, templates: LayoutTemplate, "at-sign": AtSign,
  calendar: CalendarDays, folder: FolderOpen, wallet: Wallet, book: BookOpen, megaphone: Megaphone, chart: ChartColumn, sunrise: Sunrise, messages: MessagesSquare,
};

/* ───────── Theme ───────── */

const ThemeContext = createContext<{ theme: UiTheme; setTheme: (t: UiTheme) => void }>({ theme: "dark", setTheme: () => {} });

/**
 * The deck's root element. Holds the person's theme and the practice accent,
 * and mirrors both onto <html> so menus and dialogs (rendered in portals
 * outside this element) match.
 */
export function DeckRoot({ theme: initial, vars, children }: { theme: UiTheme; vars: Record<string, string>; children: React.ReactNode }) {
  const [theme, setThemeState] = useState<UiTheme>(initial);
  const [, start] = useTransition();
  const router = useRouter();
  const varsKey = JSON.stringify(vars);

  useEffect(() => {
    const html = document.documentElement;
    html.dataset.theme = theme;
    const entries = Object.entries(JSON.parse(varsKey) as Record<string, string>);
    for (const [k, v] of entries) html.style.setProperty(k, v);
    return () => {
      delete html.dataset.theme;
      for (const [k] of entries) html.style.removeProperty(k);
    };
  }, [theme, varsKey]);

  const setTheme = (t: UiTheme) => {
    setThemeState(t);
    start(async () => {
      await setThemeAction(t);
      router.refresh();
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div data-theme={theme} data-deck="" style={vars as React.CSSProperties} className="flex min-h-screen flex-col bg-paper text-ink">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

/* ───────── Navigation ───────── */

const menuContent = "z-50 min-w-[240px] rounded-xl border border-hairline-strong bg-surface p-1.5 text-ink shadow-[0_18px_50px_-18px_rgba(29,34,48,.35)]";
const menuItem = "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink outline-none data-[highlighted]:bg-sunken";

function isActive(item: NavItem, pathname: string) {
  const path = item.href.split("?")[0];
  if (item.exact) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`) || (item.match ?? []).some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

function Badge({ n, className, label = "unread" }: { n?: number; className?: string; label?: string }) {
  if (!n) return null;
  return (
    <span className={cn("min-w-5 rounded-full bg-hub-red px-1.5 text-center text-[11px] leading-5 font-semibold text-white", className)} aria-label={`${n} ${label}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Sidebar groups, so the list reads in a few short sections. */
const SECTIONS: { key: string; label: string | null; icons: IconName[] }[] = [
  { key: "work", label: null, icons: ["sunrise", "gauge", "layout", "inbox", "messages", "contact"] },
  { key: "clients", label: "Client work", icons: ["user-round", "calendar", "folder", "wallet", "file-text", "templates"] },
  { key: "insights", label: "Insights", icons: ["chart", "book", "megaphone"] },
];

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = ICONS[item.icon];
  const active = isActive(item, pathname);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={item.soon ? `${item.label}: arrives in ${item.soon}` : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] transition-colors",
        active ? "bg-accent-soft font-semibold text-ink" : "text-ink-2 hover:bg-sunken hover:text-ink",
        item.soon && !active && "text-muted",
      )}
    >
      {active ? <span className="absolute inset-y-2 -left-3 w-[3px] rounded-r-full bg-accent" aria-hidden="true" /> : null}
      <Icon className={cn("size-[18px] shrink-0", active ? "text-accent" : "text-muted group-hover:text-ink-2")} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.soon ? <span className="rounded-full bg-sunken px-1.5 text-[10px] font-medium text-muted">Soon</span> : null}
      <Badge n={item.badge} label={item.badgeLabel} />
    </Link>
  );
}

/** The left-hand navigation: grouped sections, with Settings kept at the bottom. */
export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  // Close the mobile drawer after moving to another page.
  useEffect(() => {
    const t = document.getElementById("nav-toggle") as HTMLInputElement | null;
    if (t) t.checked = false;
  }, [pathname]);
  const placed = new Set<NavItem>();
  const groups = SECTIONS.map((sec) => {
    const list = items.filter((i) => sec.icons.includes(i.icon));
    list.forEach((i) => placed.add(i));
    return { ...sec, list };
  });
  const bottom = items.filter((i) => !placed.has(i));
  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {groups.filter((g) => g.list.length).map((g) => (
          <div key={g.key} className="mt-4 first:mt-1">
            {g.label ? <p className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{g.label}</p> : null}
            <ul className="flex flex-col gap-0.5">
              {g.list.map((item) => <li key={item.href}><NavLink item={item} pathname={pathname} /></li>)}
            </ul>
          </div>
        ))}
      </div>
      {bottom.length ? (
        <ul className="flex flex-col gap-0.5 border-t border-hairline px-3 py-2">
          {bottom.map((item) => <li key={item.href}><NavLink item={item} pathname={pathname} /></li>)}
        </ul>
      ) : null}
    </nav>
  );
}

/** The current section's name for the top bar. */
export function PageContext({ items, workspace }: { items: NavItem[]; workspace: string }) {
  const pathname = usePathname();
  const hit = [...items].sort((a, b) => b.href.length - a.href.length).find((i) => isActive(i, pathname));
  return (
    <p className="min-w-0 truncate text-[13px] text-muted max-sm:hidden">
      <span>{workspace}</span>
      {hit ? <><span className="mx-1.5 text-hairline-strong">/</span><span className="font-semibold text-ink">{hit.label}</span></> : null}
    </p>
  );
}

/* ───────── Header ───────── */


function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color }} aria-hidden="true" />;
}

export function WorkspaceSwitcher({ options, currentKey }: { options: WorkspaceOption[]; currentKey: string | null }) {
  const current = options.find((o) => o.key === currentKey) ?? options[0];
  return (
    <DM.Root>
      <DM.Trigger
        className="flex w-full items-center gap-2.5 rounded-xl border border-hairline bg-surface p-2 text-left shadow-card transition-colors hover:border-hairline-strong"
        aria-label={`Workspace: ${current?.label ?? "none"}. Switch workspace`}
      >
        {current?.kind === "firm" ? (
          <FirmSwatch color={current.dot} label={current.label} />
        ) : (
          <HubMark className="size-7 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[10.5px] font-medium tracking-[0.06em] text-muted uppercase">Workspace</span>
          <span className="block truncate text-[13px] font-semibold text-ink">{current?.label ?? "No workspace"}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={6} className={cn(menuContent, "w-[var(--radix-dropdown-menu-trigger-width)]")}>
          <DM.Label className="px-2.5 py-1.5 text-xs text-muted">Workspaces you can open</DM.Label>
          {options.map((o) => (
            <DM.Item key={o.key} asChild>
              <Link href={o.href} className={menuItem}>
                {o.kind === "firm" ? <Dot color={o.dot} /> : <HubMark className="size-4" />}
                <span className="flex-1 truncate">{o.label}</span>
                {o.key === current?.key ? <Check className="size-4 text-accent" /> : null}
              </Link>
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function NewMenu({ actions }: { actions: { label: string; href: string }[] }) {
  if (!actions.length) return null;
  return (
    <DM.Root>
      <DM.Trigger className="flex h-10 items-center gap-2 rounded-xl bg-hub-red px-4 text-sm font-semibold text-white shadow-card hover:bg-hub-red-deep max-sm:w-10 max-sm:justify-center max-sm:px-0">
        <Plus className="size-4" strokeWidth={2.5} />
        <span className="max-sm:sr-only">New</span>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={8} className={menuContent}>
          {actions.map((a) => (
            <DM.Item key={a.href + a.label} asChild>
              <Link href={a.href} className={menuItem}>{a.label}</Link>
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

const THEMES: { value: UiTheme; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "Match this device", icon: Monitor },
];

export function UserMenu({ name, email, initials }: { name: string; email: string; initials: string }) {
  const { theme, setTheme } = useContext(ThemeContext);
  return (
    <DM.Root>
      <DM.Trigger className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-sunken" aria-label={`Account menu for ${name}`}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-navy text-[12px] font-bold text-white" aria-hidden="true">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{name}</span>
          <span className="block truncate text-[11.5px] text-muted">{email}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content side="top" align="start" sideOffset={6} className={menuContent}>
          <div className="px-2.5 py-2">
            <p className="truncate text-[13px] font-semibold text-ink">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
          </div>
          <DM.Separator className="my-1 h-px bg-hairline" />
          <DM.Label className="px-2.5 pt-1.5 pb-1 text-xs text-muted">Appearance</DM.Label>
          <DM.RadioGroup value={theme} onValueChange={(v) => setTheme(v as UiTheme)}>
            {THEMES.map((t) => (
              <DM.RadioItem key={t.value} value={t.value} className={menuItem} onSelect={(e) => e.preventDefault()}>
                <t.icon className="size-4 text-muted" />
                <span className="flex-1">{t.label}</span>
                <DM.ItemIndicator><Check className="size-4 text-accent" /></DM.ItemIndicator>
              </DM.RadioItem>
            ))}
          </DM.RadioGroup>
          <DM.Separator className="my-1 h-px bg-hairline" />
          <DM.Item asChild>
            <Link href="/account" className={menuItem}>
              <UserRound className="size-4 text-muted" /> Your account and security
            </Link>
          </DM.Item>
          <DM.Item asChild>
            <form action={signOutAction}>
              <button className={cn(menuItem, "w-full text-left hover:bg-sunken")}>
                <LogOut className="size-4 text-muted" /> Sign out
              </button>
            </form>
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function MobileNavToggle() {
  return (
    <label htmlFor="nav-toggle" className="-ml-1 inline-flex size-10 cursor-pointer items-center justify-center rounded-xl text-ink-2 hover:bg-sunken lg:hidden" aria-label="Open navigation">
      <Menu className="size-5" />
    </label>
  );
}

export function FirmSwatch({ color, label, small }: { color: string; label: string; small?: boolean }) {
  const initials = label.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-md font-semibold text-white ring-1 ring-white/20", small ? "size-5 text-[9px]" : "size-7 text-[11px]")}
      style={{ background: color }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
