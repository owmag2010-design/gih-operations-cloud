import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, Facts, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { fullName } from "@/lib/labels";
import { NotFoundError } from "@/server/errors";
import { getClient } from "@/server/modules/clients/clients";
import { ComposeDialog } from "@/components/email/client";
import { requireFirm } from "@/server/next/session";
import { Timeline } from "../../timeline";
import { ClientNoteForm } from "./note-form";

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
          <Panel>
            <PanelHeader title="Matters" />
            <p className="p-4 text-[13px] text-muted">Immigration cases, checklists and documents for this client arrive with case management in Release 3.</p>
          </Panel>
          <Panel>
            <PanelHeader title="Activity" description="Internal: never shown to the client." />
            {canEdit ? <div className="border-b border-hairline p-4"><ClientNoteForm firmSlug={firm.slug} clientId={client.id} /></div> : null}
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
            <PanelHeader title="Consent" />
            {consents.length === 0 ? <p className="p-4 text-[13px] text-muted">No consent recorded.</p> : (
              <ul className="divide-y divide-hairline">
                {consents.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 text-[13px]">
                    <div className="flex items-center justify-between"><span className="capitalize">{c.purpose.replace("_", " ")}</span><Badge tone={c.granted ? "ok" : "danger"}>{c.granted ? "Given" : "Refused"}</Badge></div>
                    <p className="text-xs text-muted">{c.method}</p>
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
