import type { Metadata } from "next";
import { ChangePasswordForm, MfaSetup } from "@/app/(auth)/forms";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Notice, PageHeader, Panel, PanelHeader, tableClass as t } from "@/components/ui/primitives";
import { isMfaMandatory } from "@/server/auth/service";
import { mySessions } from "@/server/modules/people/people";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Your account" };

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" on ");
}

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const { ctx, session } = await requireStaff({ allowMfaSetup: true });
  const mandatory = await isMfaMandatory(ctx);
  const sessions = await mySessions(ctx);
  const { setup } = await searchParams;

  return (
    <>
      <PageHeader title="Your account" description={`${ctx.user.name}, ${ctx.user.email}`} />
      {setup === "required" && !session.user.mfaEnabled ? (
        <Notice tone="warn" className="mb-5">Your role requires two-step sign-in. Set it up below to continue using the platform.</Notice>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-5">
          <Panel id="security">
            <PanelHeader title="Two-step sign-in" description={mandatory ? "Required for your role." : "Recommended for everyone who handles client records."} />
            <div className="p-4"><MfaSetup enabled={session.user.mfaEnabled} mandatory={mandatory} /></div>
          </Panel>
          <Panel>
            <PanelHeader title="Password" description="Changing it signs you out of your other sessions." />
            <div className="p-4"><ChangePasswordForm /></div>
          </Panel>
          <Panel>
            <PanelHeader title="Where you're signed in" description="Sessions end after 12 hours without activity, and after 7 days at most." />
            <div className={t.wrap}>
              <table className={t.table}>
                <thead><tr><th className={t.th}>Device</th><th className={t.th}>IP address</th><th className={t.th}>Signed in</th><th className={t.th}>Last active</th></tr></thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td className={t.td}>{device(s.userAgent)} {s.id === session.id ? <Badge tone="accent" className="ml-1">This device</Badge> : null}</td>
                      <td className={`${t.td} num text-ink-2`}>{s.ip ?? "Unknown"}</td>
                      <td className={t.td}><LocalTime value={s.createdAt} /></td>
                      <td className={t.td}><LocalTime value={s.lastSeenAt} mode="relative" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <Panel className="self-start">
          <PanelHeader title="Your access" description="Ask an administrator if something here is wrong." />
          <ul className="divide-y divide-hairline">
            {ctx.group ? (
              <li className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]">
                <span className="text-ink">Global Immigration Hub</span>
                <Badge tone="outline">{ctx.group.roleName}</Badge>
              </li>
            ) : null}
            {[...ctx.firms.values()].map((f) => (
              <li key={f.firmId} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]">
                <span className="flex items-center gap-2 text-ink"><span className="size-2.5 rounded-full" style={{ background: f.brandColor }} aria-hidden="true" />{f.tradingName}</span>
                <Badge tone="outline">{f.roleName}</Badge>
              </li>
            ))}
            {!ctx.group && ctx.firms.size === 0 ? <li className="px-4 py-3 text-[13px] text-muted">You don&apos;t have access to any workspace yet.</li> : null}
          </ul>
        </Panel>
      </div>
    </>
  );
}
