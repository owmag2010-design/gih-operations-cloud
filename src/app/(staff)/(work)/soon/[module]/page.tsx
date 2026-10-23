import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MODULES, type ModuleKey } from "@/components/shell/nav";
import { Notice, PageHeader, Panel } from "@/components/ui/primitives";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Not built yet" };

/** Honest placeholder for a workspace that hasn't been built: what it will do and when. */
export default async function ComingModulePage({ params }: PageProps<"/soon/[module]">) {
  await requireStaff();
  const { module } = await params;
  const m = MODULES[module as ModuleKey];
  if (!m) notFound();
  return (
    <>
      <PageHeader title={m.title} description={`Not built yet. Planned for milestone ${m.milestone}.`} />
      <Panel className="max-w-3xl p-5">
        <p className="text-[14px] leading-relaxed text-ink">{m.summary}</p>
        <Notice className="mt-4">Nothing on this page is live. When this workspace is built it will appear here with real records, and this notice will go.</Notice>
      </Panel>
    </>
  );
}
