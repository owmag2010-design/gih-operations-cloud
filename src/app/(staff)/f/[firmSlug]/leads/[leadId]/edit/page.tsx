import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { fullName } from "@/lib/labels";
import { assignableUsers, getLead } from "@/server/modules/crm/leads";
import { requireFirm } from "@/server/next/session";
import { updateLeadAction } from "../../../actions";
import { LeadForm } from "../../lead-form";

export const metadata: Metadata = { title: "Edit lead" };

export default async function EditLeadPage({ params }: PageProps<"/f/[firmSlug]/leads/[leadId]/edit">) {
  const { firmSlug, leadId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("leads:edit", firm.firmId)) notFound();
  const { lead } = await getLead(ctx, firm.firmId, leadId).catch(() => notFound());
  const canAssign = ctx.has("leads:assign", firm.firmId);
  const people = canAssign ? await assignableUsers(ctx, firm.firmId) : [];
  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit ${fullName(lead.firstName, lead.lastName)}`} description={lead.ref} />
      <LeadForm
        action={updateLeadAction.bind(null, firm.slug, lead.id)}
        initial={{ ...lead, followUpAt: lead.followUpAt?.toISOString() ?? null }}
        people={people}
        canAssign={canAssign}
        mode="edit"
        cancelHref={`/f/${firm.slug}/leads/${lead.id}`}
        selfId={ctx.user.id}
      />
    </div>
  );
}
