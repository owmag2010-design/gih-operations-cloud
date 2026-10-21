import type { AccessContext } from "@/server/access/context";
import { CommandPalette } from "./command-palette";
import { MobileNavToggle, SidebarNav, WorkspaceSwitcher, UserMenu } from "./client";
import type { FutureItem, NavItem, Workspace } from "./nav";

export type WorkspaceOption = { key: string; label: string; href: string; color: string | null; kind: "hq" | "firm" };

function workspaceOptions(ctx: AccessContext): WorkspaceOption[] {
  const opts: WorkspaceOption[] = [];
  if (ctx.has("metrics:group") || ctx.has("intake:view") || ctx.has("firms:view") || ctx.has("staff:view")) {
    opts.push({ key: "hq", label: "Hub headquarters", href: "/hq", color: null, kind: "hq" });
  }
  for (const f of [...ctx.firms.values()].sort((a, b) => a.tradingName.localeCompare(b.tradingName))) {
    if (f.permissions.has("firm:view")) opts.push({ key: f.firmId, label: f.tradingName, href: `/f/${f.slug}`, color: f.brandColor, kind: "firm" });
  }
  return opts;
}

/**
 * Staff application frame. The active firm's brand colour runs down the
 * sidebar edge so people always know whose records they are looking at.
 */
export function AppShell({
  ctx,
  workspace,
  nav,
  future,
  quickActions,
  children,
}: {
  ctx: AccessContext;
  workspace: Workspace;
  nav: NavItem[];
  future: FutureItem[];
  quickActions?: { label: string; href: string }[];
  children: React.ReactNode;
}) {
  const color = workspace.kind === "firm" ? workspace.color : "var(--hub-red)";
  const options = workspaceOptions(ctx);
  const current = workspace.kind === "firm" ? options.find((o) => o.kind === "firm" && o.href === `/f/${workspace.slug}`) : options.find((o) => o.kind === "hq");
  const commandNav = [...nav.map((n) => ({ label: n.label, href: n.href })), ...options.map((o) => ({ label: `Open ${o.label}`, href: o.href })), { label: "Your account", href: "/account" }];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]" style={{ ["--firm" as string]: color }}>
      <input type="checkbox" id="nav-toggle" className="peer sr-only" aria-hidden="true" tabIndex={-1} />
      <aside
        className="fixed inset-y-0 left-0 z-30 flex w-[248px] -translate-x-full flex-col border-r border-hairline bg-surface transition-transform peer-checked:translate-x-0 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0"
        aria-label="Main"
      >
        <div className="absolute inset-y-0 left-0 w-[3px] bg-firm" aria-hidden="true" />
        <div className="border-b border-hairline px-3 py-3">
          <WorkspaceSwitcher options={options} currentKey={current?.key ?? null} />
        </div>
        <SidebarNav items={nav} future={future} />
        <div className="border-t border-hairline px-3 py-3">
          <UserMenu name={ctx.user.name} email={ctx.user.email} />
        </div>
      </aside>
      <label htmlFor="nav-toggle" className="fixed inset-0 z-20 hidden bg-ink/20 peer-checked:block lg:hidden" aria-hidden="true" />
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-hairline bg-paper/90 px-4 backdrop-blur lg:px-8">
          <MobileNavToggle />
          <div className="ml-auto flex items-center gap-2">
            <CommandPalette navigation={commandNav} quickActions={quickActions ?? []} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
