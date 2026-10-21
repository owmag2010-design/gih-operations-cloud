import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { listFirmTeam } from "@/server/modules/people/people";
import { requireFirm } from "@/server/next/session";
import { createClientAction } from "../../actions";
import { ClientForm } from "../client-form";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage({ params }: PageProps<"/f/[firmSlug]/clients/new">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("clients:create", firm.firmId)) notFound();
  const team = ctx.has("team:view", firm.firmId) ? await listFirmTeam(ctx, firm.firmId) : [];
  return (
    <div className="max-w-3xl">
      <PageHeader title="New client" description="For people who come to the firm directly. Leads become clients through “Convert to client”." />
      <ClientForm action={createClientAction.bind(null, firm.slug)} people={team.filter((m) => m.status === "active").map((m) => ({ id: m.userId, name: m.name }))} mode="create" cancelHref={`/f/${firm.slug}/clients`} />
    </div>
  );
}
