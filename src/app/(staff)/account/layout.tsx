import { AppShell } from "@/components/shell/app-shell";
import { hqNav } from "@/components/shell/nav";
import { requireStaff } from "@/server/next/session";

export default async function AccountLayout({ children }: LayoutProps<"/account">) {
  const { ctx } = await requireStaff({ allowMfaSetup: true });
  return (
    <AppShell ctx={ctx} workspace={{ kind: "hq" }} nav={[{ label: "Your account", href: "/account", icon: "user-round", exact: true }, ...hqNav(ctx)]} future={[]}>
      {children}
    </AppShell>
  );
}
