import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Notice, PageHeader, Panel, PanelHeader, cn } from "@/components/ui/primitives";
import { env } from "@/server/env";
import { providerConfigured, redirectUri } from "@/server/integrations/mail/oauth";
import { resendConfigured } from "@/server/integrations/resend";
import { canManageMailbox, canSendInbox, visibleMailboxes } from "@/server/modules/email/access";
import { listFirms } from "@/server/modules/org/firms";
import { connectionSummaries } from "@/server/modules/email/sync";
import { requireStaff } from "@/server/next/session";
import { ConnectButtons, MailboxActions, MailboxForm } from "./client";

export const metadata: Metadata = { title: "Email settings" };

const PROVIDER: Record<string, string> = { microsoft: "Microsoft 365", google: "Gmail", forwarding: "Forwarding (Resend)" };

function Health({ status, error }: { status: string | null; error: string | null }) {
  if (!status) return <Badge tone="outline">Forwarding only</Badge>;
  if (status === "connected") return <Badge tone="ok">Connected</Badge>;
  if (status === "needs_reconnect") return <Badge tone="danger" title={error ?? undefined}>Needs reconnecting</Badge>;
  if (status === "error") return <Badge tone="danger" title={error ?? undefined}>Sync failing</Badge>;
  return <Badge tone="neutral">Disconnected</Badge>;
}

export default async function EmailSettingsPage({ searchParams }: PageProps<"/settings/email">) {
  const { ctx } = await requireStaff();
  const sp = (await searchParams) as { connected?: string; error?: string };
  const [boxes, conns] = await Promise.all([visibleMailboxes(ctx), connectionSummaries(ctx)]);
  const firms = ctx.has("mailboxes:manage") ? await listFirms(ctx).catch(() => []) : [];
  const practices = [
    ...(canSendInbox(ctx, null) ? [{ id: "hub", name: "Global Immigration Hub" }] : []),
    ...[...ctx.firms.values()].filter((f) => f.permissions.has("email:send")).map((f) => ({ id: f.firmId, name: f.tradingName })),
  ];
  const mine = boxes.filter((b) => b.kind === "personal" && b.ownerUserId === ctx.user.id);
  const shared = boxes.filter((b) => b.kind === "shared");
  const ms = providerConfigured("microsoft");
  const gm = providerConfigured("google");
  const admin = ctx.has("mailboxes:manage");

  return (
    <>
      <PageHeader title="Email" description="Connect mailboxes so mail in and out appears in the Inbox, and manage the shared inboxes for each practice." actions={<Link href="/settings/signatures" className="text-[13px] text-ink-2 underline-offset-2 hover:underline">Signatures →</Link>} />
      <div className="flex flex-col gap-5">
        {sp.connected ? <Notice tone="ok">Connected {sp.connected}. The last {90} days of mail are importing; new mail syncs every few minutes.</Notice> : null}
        {sp.error ? <Notice tone="danger">{sp.error}</Notice> : null}

        <Panel>
          <PanelHeader title="Your mailboxes" description="Personal mailboxes are private to you unless you share them. Sending from them uses your own account, so replies land in your Sent folder too." />
          <div className="flex flex-col divide-y divide-hairline">
            {mine.length ? mine.map((b) => {
              const c = conns.get(b.id);
              return (
                <div key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{b.accountEmail ?? b.fromAddress} <span className="font-normal text-muted">· {b.firmName ?? "Global Immigration Hub"} · {PROVIDER[b.provider]}</span></p>
                    <p className="mt-0.5 text-xs text-muted">
                      {c?.importState && c.importState.phase !== "done" ? <>Importing history: {c.importState.imported} messages so far · </> : c?.importState ? <>{c.importState.imported} messages imported · </> : null}
                      Last synced {c?.lastSuccessAt ? <LocalTime value={c.lastSuccessAt} mode="relative" /> : "not yet"}
                      {c?.lastError ? <span className="text-danger"> · {c.lastError}</span> : null}
                    </p>
                  </div>
                  <Health status={c?.status ?? null} error={c?.lastError ?? null} />
                  <MailboxActions mailboxId={b.id} provider={b.provider} canManage connected={c?.status === "connected" || c?.status === "error"} />
                </div>
              );
            }) : <p className="px-4 py-3 text-[13px] text-muted">You haven&apos;t connected a mailbox yet.</p>}
          </div>
          <div className="border-t border-hairline bg-paper px-4 py-3">
            <ConnectButtons practices={practices} microsoft={ms} google={gm} />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Shared inboxes" description="Team inboxes per practice (for example hello@thegih.com). Everyone with inbox access in that practice can read and reply." />
          <div className="flex flex-col divide-y divide-hairline">
            {shared.map((b) => {
              const c = conns.get(b.id);
              const manage = canManageMailbox(ctx, b);
              return (
                <div key={b.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">{b.label} <span className="font-normal text-muted">· {b.firmName ?? "Global Immigration Hub"}</span></p>
                      <p className="mt-0.5 text-xs text-muted">
                        {b.provider === "forwarding" ? <>Receives mail redirected to <code className="text-ink">{b.inboundAddress ?? "—"}</code> · sends as {b.fromName} &lt;{b.fromAddress}&gt; via Resend</> : <>Synced with {PROVIDER[b.provider]} as {c?.accountEmail ?? b.fromAddress}{c?.lastSuccessAt ? <> · last synced <LocalTime value={c.lastSuccessAt} mode="relative" /></> : null}{c?.importState && c.importState.phase !== "done" ? <> · importing ({c.importState.imported} so far)</> : null}</>}
                        {c?.lastError ? <span className="text-danger"> · {c.lastError}</span> : null}
                      </p>
                    </div>
                    <Health status={c?.status ?? null} error={c?.lastError ?? null} />
                    {manage ? <MailboxActions mailboxId={b.id} provider={b.provider} canManage connected={c?.status === "connected" || c?.status === "error"} microsoft={ms} google={gm} /> : null}
                  </div>
                  {admin ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted hover:text-ink">Edit addresses</summary>
                      <div className="mt-3"><MailboxForm firms={firms.map((f) => ({ id: f.id, name: f.tradingName }))} box={{ id: b.id, firmId: b.firmId, label: b.label, inboundAddress: b.inboundAddress ?? "", forwardedFrom: b.forwardedFrom, fromName: b.fromName, fromAddress: b.fromAddress, signature: b.signature, isActive: b.isActive }} /></div>
                    </details>
                  ) : null}
                </div>
              );
            })}
            {!shared.length ? <p className="px-4 py-3 text-[13px] text-muted">No shared inboxes you can see.</p> : null}
          </div>
          {admin ? (
            <details className="border-t border-hairline bg-paper px-4 py-3">
              <summary className="cursor-pointer text-[13px] font-medium text-ink">Add a shared inbox</summary>
              <div className="mt-3"><MailboxForm firms={firms.map((f) => ({ id: f.id, name: f.tradingName }))} box={{ id: null, firmId: null, label: "", inboundAddress: "", forwardedFrom: null, fromName: "", fromAddress: "", signature: null, isActive: true }} /></div>
            </details>
          ) : null}
        </Panel>

        {admin ? (
          <Panel>
            <PanelHeader title="Server connections" description="What's set up on the server. Anything missing is shown here rather than hidden behind a button that doesn't work." />
            <ul className="flex flex-col divide-y divide-hairline text-[13px]">
              {[
                ["Sending through Resend (system and forwarded inboxes)", resendConfigured(), "Add RESEND_API_KEY in Vercel."],
                ["Receiving forwarded mail (Resend webhook, signed)", Boolean(env().RESEND_WEBHOOK_SECRET), "Add RESEND_WEBHOOK_SECRET in Vercel."],
                ["Microsoft 365 mailbox connections", ms, `Register an app in Azure (Entra ID) with redirect URI ${redirectUri("microsoft")}, then set MS_CLIENT_ID and MS_CLIENT_SECRET.`],
                ["Gmail mailbox connections", gm, `Create an OAuth client in Google Cloud with redirect URI ${redirectUri("google")}, then set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.`],
                ["Scheduled sync every 5 minutes", Boolean(env().CRON_SECRET), "Set CRON_SECRET in Vercel (any long random value). Until then, mailboxes sync only when someone presses Sync now."],
              ].map(([label, ok, fix]) => (
                <li key={String(label)} className="flex items-start gap-3 px-4 py-2.5">
                  <span className={cn("mt-1 size-2 shrink-0 rounded-full", ok ? "bg-ok" : "bg-warn")} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-ink">{label}</p>
                    {!ok ? <p className="text-xs break-words text-muted">{fix}</p> : null}
                  </div>
                  <Badge tone={ok ? "ok" : "warn"}>{ok ? "Ready" : "Not set up"}</Badge>
                </li>
              ))}
            </ul>
            <p className="border-t border-hairline px-4 py-2.5 text-xs text-muted">Resend webhook address: <code className="text-ink">{env().APP_URL}/api/email/webhook</code></p>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
