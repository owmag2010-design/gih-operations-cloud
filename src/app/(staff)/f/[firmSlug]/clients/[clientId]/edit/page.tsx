import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { fullName } from "@/lib/labels";
import { getClient } from "@/server/modules/clients/clients";
import { listFirmTeam } from "@/server/modules/people/people";
import { requireFirm } from "@/server/next/session";
import { updateClientAction } from "../../../actions";
import { ClientForm } from "../../client-form";

export const metadata: Metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: PageProps<"/f/[firmSlug]/clients/[clientId]/edit">) {
  const { firmSlug, clientId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("clients:edit", firm.firmId)) notFound();
  const { client } = await getClient(ctx, firm.firmId, clientId).catch(() => notFound());
  const team = ctx.has("team:view", firm.firmId) ? await listFirmTeam(ctx, firm.firmId) : [];
  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit ${fullName(client.firstName, client.lastName)}`} description={client.ref} />
      <ClientForm action={updateClientAction.bind(null, firm.slug, client.id)} initial={client} people={team.filter((m) => m.status === "active").map((m) => ({ id: m.userId, name: m.name }))} mode="edit" cancelHref={`/f/${firm.slug}/clients/${client.id}`} />
    </div>
  );
}
