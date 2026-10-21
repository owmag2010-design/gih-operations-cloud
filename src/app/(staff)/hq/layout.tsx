import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { HQ_FUTURE, hqNav } from "@/components/shell/nav";
import { requireStaff } from "@/server/next/session";

export default async function HqLayout({ children }: LayoutProps<"/hq">) {
  const { ctx } = await requireStaff();
  const nav = hqNav(ctx);
  if (!nav.length) notFound();
  const quick = ctx.has("intake:create") ? [{ label: "Capture an enquiry", href: "/hq/intake/new" }] : [];
  return (
    <AppShell ctx={ctx} workspace={{ kind: "hq" }} nav={nav} future={HQ_FUTURE} quickActions={quick}>
      {children}
    </AppShell>
  );
}
