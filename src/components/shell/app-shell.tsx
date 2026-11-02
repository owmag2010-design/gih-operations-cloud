import Link from "next/link";
import type { AccessContext } from "@/server/access/context";
import { currentSession } from "@/server/next/session";
import { HubLogo, HubMark } from "../hub-mark";
import { CommandPalette } from "./command-palette";
import { DeckRoot, FirmSwatch, MobileNavToggle, NewMenu, PageContext, SideNav, UserMenu, WorkspaceSwitcher } from "./client";
import type { FutureItem, NavItem, Workspace } from "./nav";
import { accentVars, firmBrand, practicePalette } from "./theme";

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
 * Staff application frame ("Hub Daylight", after thegih.com): a fixed left
 * sidebar with the logo, the workspace switcher, grouped navigation and the
 * account menu; a slim top bar with where you are, search and quick actions;
 * then the page. On small screens the sidebar slides in as a drawer. The
 * practice whose records are open sets the accent colour, so people always
 * know whose work they are looking at. Light/dark comes from the profile.
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
  const brand = workspace.kind === "firm" ? firmBrand(workspace.slug) : null;
  const commandNav = [...nav.map((n) => ({ label: n.label, href: n.href })), ...options.map((o) => ({ label: `Open ${o.label}`, href: o.href })), { label: "Your account", href: "/account" }];

  return (
    <DeckRoot theme={theme} vars={accentVars(palette)}>
      <input type="checkbox" id="nav-toggle" className="peer sr-only" aria-hidden="true" tabIndex={-1} />
      <aside
        className="fixed inset-y-0 left-0 z-40 flex w-[264px] -translate-x-full flex-col border-r border-hairline bg-surface transition-transform peer-checked:translate-x-0 lg:translate-x-0"
        aria-label="Navigation"
      >
        {brand && workspace.kind === "firm" ? (
          <Link href={`/f/${workspace.slug}`} className="flex h-16 shrink-0 items-center px-5" aria-label={`${workspace.name}: practice overview`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logo} alt={workspace.name} className="light-only w-auto max-w-[200px] object-contain" style={{ height: brand.logoHeight }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logoWhite} alt={workspace.name} className="dark-only w-auto max-w-[200px] object-contain" style={{ height: brand.logoHeight }} />
          </Link>
        ) : (
          <Link href="/today" className="flex h-16 shrink-0 items-center px-5" aria-label="Global Immigration Hub: my day">
            <HubLogo className="light-only h-[18px] w-auto" />
            <HubLogo tone="white" className="dark-only h-[18px] w-auto" />
          </Link>
        )}
        <div className="px-3 pb-2">
          <WorkspaceSwitcher options={options} currentKey={current?.key ?? null} />
        </div>
        <SideNav items={nav} />
        <div className="border-t border-hairline p-2">
          <UserMenu name={ctx.user.name} email={ctx.user.email} initials={initialsOf(ctx.user.name)} />
        </div>
      </aside>
      <label htmlFor="nav-toggle" className="fixed inset-0 z-30 hidden bg-ink/30 peer-checked:block lg:hidden" aria-hidden="true" />
      <div className="flex min-h-screen flex-1 flex-col lg:pl-[264px]">
        <header className="sticky top-0 z-20 border-b border-hairline bg-paper/85 backdrop-blur-md">
          <div className="flex h-16 items-center gap-3 px-4 lg:px-8">
            <MobileNavToggle />
            <Link href="/today" className="shrink-0 lg:hidden" aria-label="My day">
              {brand && workspace.kind === "firm" ? <FirmSwatch color={palette.light.base} label={workspace.name} slug={workspace.slug} className="size-8 rounded-lg" /> : <HubMark className="size-8" />}
            </Link>
            <PageContext items={nav} workspace={current?.label ?? "Hub"} />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <CommandPalette navigation={commandNav} quickActions={quickActions ?? []} />
              <NewMenu actions={quickActions ?? []} />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-6 lg:px-8 lg:py-8 has-[[data-full-bleed]]:max-w-none has-[[data-full-bleed]]:p-0">{children}</main>
      </div>
    </DeckRoot>
  );
}
