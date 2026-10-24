import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { HQ_FUTURE, hqNav } from "@/components/shell/nav";
import { unreadCount } from "@/server/modules/email/mail";
import { taskCounts } from "@/server/modules/tasks/tasks";
import { requireStaff } from "@/server/next/session";

export default async function HqLayout({ children }: LayoutProps<"/hq">) {
  const { ctx } = await requireStaff();
  const [unread, tc] = await Promise.all([unreadCount(ctx).catch(() => 0), taskCounts(ctx).catch(() => ({ overdue: 0 }))]);
  const nav = hqNav(ctx, { unread, tasksDue: tc.overdue });
  if (nav.length <= 1) notFound();
  const quick = ctx.has("intake:create") ? [{ label: "Capture an enquiry", href: "/hq/intake/new" }] : [];
  return (
    <AppShell ctx={ctx} workspace={{ kind: "hq" }} nav={nav} future={HQ_FUTURE} quickActions={quick}>
      {children}
    </AppShell>
  );
}
