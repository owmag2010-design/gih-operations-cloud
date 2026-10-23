"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import {
  Building2,
  Check,
  ChevronsUpDown,
  Contact,
  Gauge,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Route,
  ScrollText,
  Settings,
  UserRound,
  Users,
  FileText,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { HubMark } from "../hub-mark";
import { cn } from "../ui/primitives";
import type { WorkspaceOption } from "./app-shell";
import type { FutureItem, IconName, NavItem } from "./nav";

const ICONS: Record<IconName, React.ComponentType<{ className?: string }>> = {
  gauge: Gauge, inbox: Inbox, route: Route, building: Building2, users: Users, scroll: ScrollText,
  contact: Contact, "user-round": UserRound, settings: Settings, layout: LayoutDashboard, "file-text": FileText,
};

export function SidebarNav({ items, future }: { items: NavItem[]; future: FutureItem[] }) {
  const pathname = usePathname();
  const [showFuture, setShowFuture] = useState(false);
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3">
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-white/75 hover:bg-white/[0.07] hover:text-white",
                  active && "bg-white/[0.11] font-medium text-white before:absolute before:inset-y-1.5 before:-left-2 before:w-[3px] before:rounded-full before:bg-hub-red",
                )}
              >
                <Icon className={cn("size-4 text-white/50", active && "text-white")} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      {future.length ? (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setShowFuture((v) => !v)}
            aria-expanded={showFuture}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-1 text-xs text-white/50 hover:text-white"
          >
            <span>Not yet released</span>
            <span aria-hidden="true">{showFuture ? "Hide" : "Show"}</span>
          </button>
          {showFuture ? (
            <ul className="mt-1 flex flex-col">
              {future.map((f) => (
                <li key={f.label} className="flex h-7 items-center justify-between px-2.5 text-[13px] text-white/40">
                  <span>{f.label}</span>
                  <span className="text-[11px]">Release {f.release}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

export function WorkspaceSwitcher({ options, currentKey }: { options: WorkspaceOption[]; currentKey: string | null }) {
  const current = options.find((o) => o.key === currentKey) ?? options[0];
  return (
    <DM.Root>
      <DM.Trigger className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-white/[0.07]" aria-label="Switch workspace">
        {current?.kind === "firm" ? <FirmSwatch color={current.color!} label={current.label} /> : <HubMark className="size-7 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white">{current?.label ?? "No workspace"}</span>
          <span className="block truncate text-xs text-white/55">{current?.kind === "firm" ? "Partner firm workspace" : "Global Immigration Hub"}</span>
        </span>
        <ChevronsUpDown className="size-4 text-white/50" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={6} className="z-50 w-[232px] rounded-lg border border-hairline bg-surface p-1 shadow-[0_8px_30px_-10px_rgba(36,34,31,.3)]">
          <DM.Label className="px-2 py-1.5 text-xs text-muted">Workspaces you can open</DM.Label>
          {options.map((o) => (
            <DM.Item key={o.key} asChild>
              <Link href={o.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink outline-none data-[highlighted]:bg-sunken">
                {o.kind === "firm" ? <FirmSwatch color={o.color!} label={o.label} small /> : <HubMark className="size-5" />}
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

export function UserMenu({ name, email }: { name: string; email: string }) {
  return (
    <DM.Root>
      <DM.Trigger className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-white/[0.07]">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold text-white" aria-hidden="true">
          {name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-white">{name}</span>
          <span className="block truncate text-xs text-white/55">{email}</span>
        </span>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content side="top" align="start" sideOffset={6} className="z-50 w-[232px] rounded-lg border border-hairline bg-surface p-1 shadow-[0_8px_30px_-10px_rgba(36,34,31,.3)]">
          <DM.Item asChild>
            <Link href="/account" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink outline-none data-[highlighted]:bg-sunken">
              <UserRound className="size-4 text-muted" /> Your account and security
            </Link>
          </DM.Item>
          <DM.Item asChild>
            <form action={signOutAction}>
              <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink outline-none hover:bg-sunken">
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
    <label htmlFor="nav-toggle" className="-ml-1 inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-ink-2 hover:bg-sunken lg:hidden" aria-label="Open navigation">
      <Menu className="size-5" />
    </label>
  );
}
