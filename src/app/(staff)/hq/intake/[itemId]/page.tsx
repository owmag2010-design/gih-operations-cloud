import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Facts, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { FLAG_LABELS, fullName, INTAKE_STATUS_LABELS, SOURCE_LABELS } from "@/lib/labels";
import { NotFoundError } from "@/server/errors";
import { getIntakeItem } from "@/server/modules/intake/intake";
import { listFirms } from "@/server/modules/org/firms";
import { requireStaff } from "@/server/next/session";
import { RouteForm, StatusButtons } from "./client";

export const metadata: Metadata = { title: "Enquiry" };

const FLAG_GUIDANCE: Record<string, string> = {
  asylum: "The firms don't handle asylum applications. Offer a consultation on other routes instead of routing this as a matter.",
  regulated_au: "Australian immigration advice must go through the separate authorised consultation process. Don't give advice here.",
  needs_information: "There isn't enough detail to choose a firm. Contact the person for more information first.",
  possible_duplicate: "The same email or phone sent another enquiry in the last 30 days. Check before routing.",
};

export default async function IntakeItemPage({ params }: PageProps<"/hq/intake/[itemId]">) {
  const { itemId } = await params;
  const { ctx } = await requireStaff();
  const { item, routedBy } = await getIntakeItem(ctx, itemId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const firms = (await listFirms(ctx)).filter((f) => f.status === "active");
  const firmName = (id: string | null) => firms.find((f) => f.id === id)?.tradingName;
  const canRoute = ctx.has("intake:route");
  const open = item.status === "new" || item.status === "held";
  const routedMember = item.routedFirmId ? ctx.firms.get(item.routedFirmId) : undefined;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-muted"><Link href="/hq/intake" className="hover:text-ink">Hub intake</Link> <span aria-hidden="true">/</span> Enquiry</nav>
      <PageHeader
        title={fullName(item.firstName, item.lastName)}
        meta={<><Badge tone={open ? "accent" : "outline"}>{INTAKE_STATUS_LABELS[item.status]}</Badge>{item.flags.map((f) => <Badge key={f} tone="warn">{FLAG_LABELS[f] ?? f}</Badge>)}</>}
        actions={canRoute ? <StatusButtons itemId={item.id} status={item.status} /> : null}
      />
      {item.flags.filter((f) => FLAG_GUIDANCE[f]).map((f) => <Notice key={f} tone="warn" className="mb-3">{FLAG_GUIDANCE[f]}</Notice>)}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader title="Enquiry" description={item.immigrationCategory ?? undefined} />
            <p className="max-w-[75ch] p-4 text-sm leading-relaxed whitespace-pre-wrap text-ink">{item.enquiry ?? "No details were given."}</p>
          </Panel>
          <Panel>
            <PanelHeader title="Person" />
            <div className="p-4">
              <Facts items={[
                ["Email", item.email], ["Phone", item.phone ? <span key="p" className="num">{item.phone}</span> : null], ["Nationality", countryName(item.nationality)],
                ["Lives in", countryName(item.currentCountry)], ["Wants to go to", countryName(item.destinationCountry)],
                ["Agreed to be contacted", item.consentContact ? "Yes" : "Not recorded"], ["Came in through", SOURCE_LABELS[item.source]],
                ["Received", <LocalTime key="r" value={item.receivedAt} />],
              ]} />
            </div>
          </Panel>
        </div>
        <Panel className="self-start">
          <PanelHeader title={item.status === "routed" ? "Routed" : "Route to a firm"} description={item.status === "routed" ? undefined : item.suggestionReason ? `Suggested by the rule “${item.suggestionReason}”.` : undefined} />
          <div className="p-4">
            {item.status === "routed" ? (
              <div className="flex flex-col gap-2 text-[13px]">
                <p className="text-ink">Sent to <span className="font-medium">{firmName(item.routedFirmId)}</span>{routedBy ? ` by ${routedBy}` : ""}, <LocalTime value={item.routedAt} mode="relative" />.</p>
                {routedMember && item.routedLeadId ? <Link href={`/f/${routedMember.slug}/leads/${item.routedLeadId}`} className="text-accent hover:underline">Open the lead in {routedMember.tradingName}</Link> : <p className="text-muted">The firm&apos;s team now holds this record.</p>}
                {item.note ? <p className="rounded-md bg-sunken px-3 py-2 text-ink-2">{item.note}</p> : null}
              </div>
            ) : !open ? (
              <p className="text-[13px] text-muted">This enquiry was closed{item.note ? `: ${item.note}` : "."} Reopen it to route it.</p>
            ) : canRoute ? (
              <RouteForm itemId={item.id} firms={firms.map((f) => ({ id: f.id, name: f.tradingName }))} suggested={item.suggestedFirmId} />
            ) : (
              <p className="text-[13px] text-muted">Suggested firm: {firmName(item.suggestedFirmId) ?? "none"}. Your role can view enquiries but not route them.</p>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
