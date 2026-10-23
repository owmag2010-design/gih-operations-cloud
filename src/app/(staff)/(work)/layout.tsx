import { AppShell } from "@/components/shell/app-shell";
import { firmNav, hqNav, type Workspace } from "@/components/shell/nav";
import { unreadCount } from "@/server/modules/email/mail";
import { requireStaff } from "@/server/next/session";

/**
 * Screens that span practices (the shared inbox, email settings, modules not
 * yet built) sit in the Hub frame for Hub staff, otherwise in the frame of the
 * practice the person last worked in.
 */
export default async function WorkLayout({ children }: LayoutProps<"/">) {
  const { ctx, session } = await requireStaff();
  const unread = await unreadCount(ctx).catch(() => 0);
  const hq = hqNav(ctx, { unread });
  const firm = (session.activeFirmId ? ctx.firms.get(session.activeFirmId) : undefined) ?? [...ctx.firms.values()][0];
  const useHq = ctx.has("metrics:group") || ctx.has("intake:view") || ctx.has("firms:view") || ctx.has("staff:view") || !firm;
  const workspace: Workspace = useHq || !firm ? { kind: "hq" } : { kind: "firm", slug: firm.slug, name: firm.tradingName, color: firm.brandColor };
  const nav = useHq || !firm ? hq : firmNav(ctx, firm.firmId, firm.slug, { unread });
  return (
    <AppShell ctx={ctx} workspace={workspace} nav={nav} future={[]}>
      {children}
    </AppShell>
  );
}
