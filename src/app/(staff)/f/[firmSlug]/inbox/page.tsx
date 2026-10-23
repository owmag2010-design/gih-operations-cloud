import { redirect } from "next/navigation";
import { requireFirm } from "@/server/next/session";

export default async function FirmInboxRedirect({ params }: PageProps<"/f/[firmSlug]/inbox">) {
  const { firmSlug } = await params;
  const { firm } = await requireFirm(firmSlug);
  redirect(`/inbox?practice=${firm.firmId}`);
}
