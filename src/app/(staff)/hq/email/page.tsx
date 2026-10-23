import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { resendConfigured } from "@/server/integrations/resend";
import { listMailboxes } from "@/server/modules/email/mail";
import { listFirms } from "@/server/modules/org/firms";
import { requireStaff } from "@/server/next/session";
import { env } from "@/server/env";
import { MailboxForm } from "./client";

export const metadata: Metadata = { title: "Email settings" };

export default async function EmailSettingsPage() {
  const { ctx } = await requireStaff();
  if (!ctx.has("mailboxes:manage")) notFound();
  const [rows, firms] = await Promise.all([listMailboxes(ctx), listFirms(ctx)]);
  const firmOptions = firms.map((f) => ({ id: f.id, name: f.tradingName }));
  const webhook = `${env().APP_URL}/api/email/webhook`;
  return (
    <>
      <PageHeader title="Email settings" description="Where each inbox receives mail and who it sends as." />
      <div className="flex flex-col gap-5">
        <Panel>
          <PanelHeader title="Connection" />
          <div className="flex flex-col gap-2 p-4 text-[13px] text-ink-2">
            <p>Sending: {resendConfigured() ? <Badge tone="ok">Connected to Resend</Badge> : <Badge tone="warn">Not connected: add RESEND_API_KEY</Badge>} · Receiving: {env().RESEND_WEBHOOK_SECRET ? <Badge tone="ok">Webhook signed</Badge> : <Badge tone="warn">Add RESEND_WEBHOOK_SECRET</Badge>}</p>
            <p>Resend webhook address (events: email.received, email.delivered, email.bounced, email.complained, email.failed): <code className="rounded bg-sunken px-1.5 py-0.5 text-ink">{webhook}</code></p>
            <p>In Outlook, add a rule on each real mailbox: <em>Redirect to</em> its receiving address below. Redirect keeps the client as the sender, so replies go to them.</p>
          </div>
        </Panel>
        {rows.map(({ mailbox: m, firmName }) => (
          <Panel key={m.id}>
            <PanelHeader title={firmName ?? "Global Immigration Hub"} description={`${m.inboundAddress} → sends as ${m.fromName} <${m.fromAddress}>`} />
            <div className="p-4"><MailboxForm firms={firmOptions} box={{ ...m }} /></div>
          </Panel>
        ))}
        <Panel>
          <PanelHeader title="Add a mailbox" />
          <div className="p-4"><MailboxForm firms={firmOptions} box={{ id: null, firmId: null, label: "", inboundAddress: "", forwardedFrom: null, fromName: "", fromAddress: "", signature: null, isActive: true }} /></div>
        </Panel>
        {!rows.length ? <Notice>No mailboxes yet.</Notice> : null}
      </div>
    </>
  );
}
