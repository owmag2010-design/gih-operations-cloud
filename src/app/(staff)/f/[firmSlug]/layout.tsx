import { AppShell } from "@/components/shell/app-shell";
import { FIRM_FUTURE, firmNav } from "@/components/shell/nav";
import { unreadCount } from "@/server/modules/email/mail";
import { taskCounts } from "@/server/modules/tasks/tasks";
import { requireFirm } from "@/server/next/session";
import { RememberFirm } from "./remember-firm";

export default async function FirmLayout({ children, params }: LayoutProps<"/f/[firmSlug]">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  const quick = [
    ...(ctx.has("leads:create", firm.firmId) ? [{ label: `New lead in ${firm.tradingName}`, href: `/f/${firm.slug}/leads/new` }] : []),
    ...(ctx.has("clients:create", firm.firmId) ? [{ label: `New client in ${firm.tradingName}`, href: `/f/${firm.slug}/clients/new` }] : []),
  ];
  return (
    <AppShell
      ctx={ctx}
      workspace={{ kind: "firm", slug: firm.slug, name: firm.tradingName, color: firm.brandColor }}
      nav={firmNav(ctx, firm.firmId, firm.slug, { unread: await unreadCount(ctx, { kind: "firm", firmId: firm.firmId }).catch(() => 0), tasksDue: (await taskCounts(ctx).catch(() => ({ overdue: 0 }))).overdue })}
      future={FIRM_FUTURE}
      quickActions={quick}
    >
      <RememberFirm firmId={firm.firmId} />
      {children}
    </AppShell>
  );
}
