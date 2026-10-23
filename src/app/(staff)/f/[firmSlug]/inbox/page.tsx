import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InboxView } from "@/components/email/inbox-view";
import { PageHeader } from "@/components/ui/primitives";
import { requireFirm } from "@/server/next/session";

export const metadata: Metadata = { title: "Inbox" };

export default async function FirmInboxPage({ params, searchParams }: PageProps<"/f/[firmSlug]/inbox">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("email:view", firm.firmId)) notFound();
  const sp = (await searchParams) as { t?: string; q?: string; status?: string };
  return (
    <>
      <PageHeader title="Inbox" description={`Email to and from ${firm.tradingName}. Replies are sent in the firm's branding and come back here.`} />
      <InboxView ctx={ctx} where={{ kind: "firm", firmId: firm.firmId }} scopeKey={firm.slug} base={`/f/${firm.slug}`} sp={sp} canSend={ctx.has("email:send", firm.firmId)} canCreateLead={ctx.has("leads:create", firm.firmId)} />
    </>
  );
}
