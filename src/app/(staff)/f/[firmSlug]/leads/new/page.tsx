import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { assignableUsers } from "@/server/modules/crm/leads";
import { requireFirm } from "@/server/next/session";
import { createLeadAction } from "../../actions";
import { LeadForm } from "../lead-form";

export const metadata: Metadata = { title: "New lead" };

export default async function NewLeadPage({ params }: PageProps<"/f/[firmSlug]/leads/new">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("leads:create", firm.firmId)) notFound();
  const canAssign = ctx.has("leads:assign", firm.firmId);
  const people = canAssign ? await assignableUsers(ctx, firm.firmId) : [];
  return (
    <div className="max-w-3xl">
      <PageHeader title="New lead" description={`Adds an enquiry directly to ${firm.tradingName}. Hub enquiries arrive through Hub intake instead.`} />
      <LeadForm action={createLeadAction.bind(null, firm.slug)} people={people} canAssign={canAssign} mode="create" cancelHref={`/f/${firm.slug}/leads`} selfId={ctx.user.id} />
    </div>
  );
}
