import Link from "next/link";
import type { AccessContext } from "@/server/access/context";
import { currentSession } from "@/server/next/session";
import { HubLogo, HubMark } from "../hub-mark";
import { CommandPalette } from "./command-palette";
import { DeckRoot, DrawerNav, MobileNavToggle, NewMenu, TopNav, UserMenu, WorkspaceSwitcher } from "./client";
import type { FutureItem, NavItem, Workspace } from "./nav";
import { accentVars, practicePalette } from "./theme";

export type WorkspaceOption = { key: string; label: string; short: string; href: string; dot: string; kind: "hq" | "firm" };

function workspaceOptions(ctx: AccessContext): WorkspaceOption[] {
  const opts: WorkspaceOption[] = [];
  if (ctx.has("metrics:group") || ctx.has("intake:view") || ctx.has("firms:view") || ctx.has("staff:view")) {
    opts.push({ key: "hq", label: "Hub headquarters", short: "Hub", href: "/hq", dot: practicePalette(null).dark.base, kind: "hq" });
  }
  for (const f of [...ctx.firms.values()].sort((a, b) => a.tradingName.localeCompare(b.tradingName))) {
    if (!f.permissions.has("firm:view")) continue;
    opts.push({ key: f.firmId, label: f.tradingName, short: f.tradingName.split(/\s+/)[0], href: `/f/${f.slug}`, dot: practicePalette(f.slug, f.brandColor).dark.base, kind: "firm" });
  }
  return opts;
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/**
 * Staff application frame ("Editorial Daylight"): a top bar with the logo,
 * pill navigation, search, the workspace switcher, quick actions and the
 * account menu, then the page. On small screens the navigation is a drawer. The practice
 * whose records are open sets the accent colour, so people always know whose
 * work they are looking at. The person's light/dark choice comes from their
 * profile.
 */
export async function AppShell({
  ctx,
  workspace,
  nav,
  quickActions,
  children,
}: {
  ctx: AccessContext;
  workspace: Workspace;
  nav: NavItem[];
  future?: FutureItem[];
  quickActions?: { label: string; href: string }[];
  children: React.ReactNode;
}) {
  const session = await currentSession();
  const theme = session?.user.uiTheme ?? "light";
  const options = workspaceOptions(ctx);
  const current = workspace.kind === "firm" ? options.find((o) => o.kind === "firm" && o.href === `/f/${workspace.slug}`) : options.find((o) => o.kind === "hq");
  const palette = workspace.kind === "firm" ? practicePalette(workspace.slug, workspace.color) : practicePalette(null);
  const commandNav = [...nav.map((n) => ({ label: n.label, href: n.href })), ...options.map((o) => ({ label: `Open ${o.label}`, href: o.href })), { label: "Your account", href: "/account" }];

  return (
    <DeckRoot theme={theme} vars={accentVars(palette)}>
      <input type="checkbox" id="nav-toggle" className="peer sr-only" aria-hidden="true" tabIndex={-1} />
      <aside
        className="fixed inset-y-0 left-0 z-40 flex w-[280px] -translate-x-full flex-col border-r border-hairline bg-paper transition-transform peer-checked:translate-x-0 lg:hidden"
        aria-label="Navigation"
      >
        <Link href="/today" className="flex items-center px-5 pt-5 pb-4" aria-label="Global Immigration Hub: my day">
          <HubLogo className="light-only h-[17px] w-auto" />
          <HubLogo tone="white" className="dark-only h-[17px] w-auto" />
        </Link>
        <DrawerNav items={nav} />
      </aside>
      <label htmlFor="nav-toggle" className="fixed inset-0 z-30 hidden bg-ink/30 peer-checked:block lg:hidden" aria-hidden="true" />
      <header className="sticky top-0 z-20 border-b border-hairline bg-paper/90 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center gap-3 px-4 lg:gap-6 lg:px-10">
          <MobileNavToggle />
          <Link href="/today" className="shrink-0" aria-label="Global Immigration Hub: my day">
            <span className="max-sm:hidden">
              <HubLogo className="light-only h-[17px] w-auto" />
              <HubLogo tone="white" className="dark-only h-[17px] w-auto" />
            </span>
            <HubMark className="size-8 sm:hidden" />
          </Link>
          <TopNav items={nav} />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <CommandPalette navigation={commandNav} quickActions={quickActions ?? []} />
            <WorkspaceSwitcher options={options} currentKey={current?.key ?? null} />
            <NewMenu actions={quickActions ?? []} />
            <UserMenu name={ctx.user.name} email={ctx.user.email} initials={initialsOf(ctx.user.name)} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-10 lg:py-8 has-[[data-full-bleed]]:max-w-none has-[[data-full-bleed]]:p-0">{children}</main>
    </DeckRoot>
  );
}
