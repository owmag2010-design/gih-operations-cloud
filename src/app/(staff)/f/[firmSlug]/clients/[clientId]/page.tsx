import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, Facts, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { CONSENT_PURPOSE, fullName } from "@/lib/labels";
import { NotFoundError } from "@/server/errors";
import { getClient } from "@/server/modules/clients/clients";
import { mattersForClient } from "@/server/modules/matters/matters";
import { listNotes } from "@/server/modules/notes/notes";
import { NotesPanel } from "@/components/work/notes";
import { Lock } from "lucide-react";
import { ComposeDialog } from "@/components/email/client";
import { requireFirm } from "@/server/next/session";
import { ClientConsentDialog } from "../../consent-client";
import { DocumentsPanel } from "../../documents/matter-panel";
import { Timeline } from "../../timeline";

export const metadata: Metadata = { title: "Client" };

export default async function ClientPage({ params, searchParams }: PageProps<"/f/[firmSlug]/clients/[clientId]">) {
  const { firmSlug, clientId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  const { client, consultant, sourceLead, timeline, consents } = await getClient(ctx, firm.firmId, clientId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const sp = await searchParams;
  const canEdit = ctx.has("clients:edit", firm.firmId);
  const base = `/f/${firm.slug}`;
  const canSeeLead = ctx.has("leads:view_all", firm.firmId);
  const canEmail = ctx.has("email:send", firm.firmId);
  const [matterRows, notes] = await Promise.all([mattersForClient(ctx, firm.firmId, client.id), listNotes(ctx, firm.firmId, { clientId: client.id })]);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-muted">
        <Link href={`${base}/clients`} className="hover:text-ink">Clients</Link> <span aria-hidden="true">/</span> <span className="num">{client.ref}</span>
      </nav>
      <PageHeader
        title={fullName(client.firstName, client.lastName)}
        meta={<Badge tone={client.status === "active" ? "ok" : "neutral"} className="capitalize">{client.status}</Badge>}
        actions={
          <>
            {canEmail ? <ComposeDialog firmId={firm.firmId} target={{ clientId: client.id }} to={client.email} /> : null}
            {canEdit ? <Button asChild><Link href={`${base}/clients/${client.id}/edit`}>Edit</Link></Button> : null}
          </>
        }
      />
      {sp.converted ? <Notice tone="ok" className="mb-4">Converted to client {client.ref}. The lead now shows as Converted.</Notice> : null}
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          {sourceLead ? (
            <Panel>
              <PanelHeader title="Original enquiry" description={sourceLead.immigrationCategory ?? undefined} actions={canSeeLead ? <Link href={`${base}/leads/${sourceLead.id}`} className="num text-[13px] text-accent hover:underline">{sourceLead.ref}</Link> : <span className="num text-[13px] text-muted">{sourceLead.ref}</span>} />
              <p className="max-w-[75ch] p-4 text-sm leading-relaxed whitespace-pre-wrap text-ink">{sourceLead.enquiry ?? "No enquiry text was recorded."}</p>
            </Panel>
          ) : null}
          {matterRows ? (
            <Panel>
              <PanelHeader title="Matters" actions={ctx.has("matters:create", firm.firmId) ? <Button asChild size="sm" variant="primary"><Link href={`${base}/matters/new?client=${client.id}`}>Open a matter</Link></Button> : null} />
              {matterRows.length ? (
                <ul className="divide-y divide-hairline">
                  {matterRows.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <Link href={`${base}/matters/${m.id}`} className="text-sm font-medium text-ink hover:underline">{m.title}</Link>
                        <p className="flex items-center gap-1.5 text-xs text-muted"><span className="num">{m.ref}</span> · opened <LocalTime value={m.openedAt} mode="date" />{m.restricted ? <span className="inline-flex items-center gap-0.5"><Lock className="size-3" /> Restricted</span> : null}</p>
                      </div>
                      <Badge tone={m.stageCategory === "closed" ? "outline" : "accent"}>{m.stageName}</Badge>
                    </li>
                  ))}
                </ul>
              ) : <p className="p-4 text-[13px] text-muted">No matters yet. Open one when the client goes ahead with a service.</p>}
            </Panel>
          ) : null}
          <DocumentsPanel ctx={ctx} firmId={firm.firmId} slug={firm.slug} link={{ clientId: client.id }} />
          <Panel>
            <PanelHeader title="Notes" />
            <NotesPanel
              slug={firm.slug}
              subject={{ clientId: client.id }}
              notes={notes.map((n) => ({ id: n.id, body: n.body, visibility: n.visibility, version: n.version, author: n.author, editor: n.editor, authorId: n.authorId, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString() }))}
              canWrite={canEdit}
              canModerate={ctx.has("firm:manage", firm.firmId)}
              meId={ctx.user.id}
            />
          </Panel>
          <Panel>
            <PanelHeader title="Activity" description="Internal: never shown to the client." />
            <Timeline items={timeline.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))} />
          </Panel>
        </div>
        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader title="Details" />
            <div className="p-4">
              <Facts
                items={[
                  ["Email", client.email ? <a href={`mailto:${client.email}`} className="text-accent hover:underline">{client.email}</a> : null],
                  ["Phone", client.phone ? <a href={`tel:${client.phone}`} className="num text-accent hover:underline">{client.phone}</a> : null],
                  ["Nationality", countryName(client.nationality)],
                  ["Lives in", countryName(client.countryOfResidence)],
                  ["Consultant", consultant?.name],
                  ["Client since", <LocalTime key="d" value={client.createdAt} mode="date" />],
                  ["Reference", <span key="r" className="num">{client.ref}</span>],
                ]}
              />
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Consent" actions={ctx.has("clients:edit", firm.firmId) ? <ClientConsentDialog slug={firm.slug} clientId={client.id} purposes={Object.entries(CONSENT_PURPOSE)} /> : null} />
            {consents.length === 0 ? <p className="p-4 text-[13px] text-muted">No consent recorded.</p> : (
              <ul className="divide-y divide-hairline">
                {consents.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 text-[13px]">
                    <div className="flex items-center justify-between"><span>{CONSENT_PURPOSE[c.purpose] ?? c.purpose}</span><Badge tone={c.granted ? "ok" : "danger"}>{c.granted ? "Given" : "Refused"}</Badge></div>
                    <p className="text-xs text-muted">{c.method} · <LocalTime value={c.recordedAt} mode="date" /></p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
