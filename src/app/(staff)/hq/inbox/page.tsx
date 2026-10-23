import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InboxView } from "@/components/email/inbox-view";
import { PageHeader } from "@/components/ui/primitives";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Hub inbox" };

export default async function HubInboxPage({ searchParams }: PageProps<"/hq/inbox">) {
  const { ctx } = await requireStaff();
  if (!ctx.has("intake:view")) notFound();
  const sp = (await searchParams) as { t?: string; q?: string; status?: string };
  return (
    <>
      <PageHeader title="Hub inbox" description="Email to hello@thegih.com. A new sender also becomes a Hub enquiry, so it can be routed to the right firm." />
      <InboxView ctx={ctx} where={{ kind: "hub" }} scopeKey="hub" base="/hq" sp={sp} canSend={ctx.has("hub_email:send")} canCreateLead={false} />
    </>
  );
}
