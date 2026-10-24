import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { matterFormOptions } from "@/server/modules/matters/matters";
import { requireFirm } from "@/server/next/session";
import { MatterForm } from "./form";

export const metadata: Metadata = { title: "Open a matter" };

export default async function NewMatterPage({ params, searchParams }: PageProps<"/f/[firmSlug]/matters/new">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("matters:create", firm.firmId)) notFound();
  const sp = await searchParams;
  const clientId = typeof sp.client === "string" ? sp.client : undefined;
  const proposalId = typeof sp.proposal === "string" ? sp.proposal : undefined;
  const opts = await matterFormOptions(ctx, firm.firmId, clientId);
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-muted">
        <Link href={`/f/${firm.slug}/matters`} className="hover:text-ink">Matters</Link> <span aria-hidden="true">/</span> Open a matter
      </nav>
      <PageHeader title="Open a matter" description="A matter is one piece of work for a client, such as a visa application or an appeal. A client can have several." />
      <Panel className="max-w-3xl p-6">
        {opts.clients.length ? (
          <MatterForm slug={firm.slug} options={opts} meId={ctx.user.id} defaults={{ clientId, proposalId }} />
        ) : (
          <p className="text-sm text-muted">There are no active clients yet. Convert a lead or <Link href={`/f/${firm.slug}/clients/new`} className="text-ink underline">add a client</Link> first.</p>
        )}
      </Panel>
    </>
  );
}
