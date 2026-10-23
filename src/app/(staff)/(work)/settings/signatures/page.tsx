import type { Metadata } from "next";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { getSignatures } from "@/server/modules/email/signatures";
import { requireStaff } from "@/server/next/session";
import { SignatureEditor } from "./client";

export const metadata: Metadata = { title: "Email signatures" };

export default async function SignaturesPage() {
  const { ctx } = await requireStaff();
  const practices = [
    ...(ctx.has("intake:view") || ctx.has("hub_email:send") ? [{ id: "hub", firmId: null as string | null, name: "Global Immigration Hub", manage: ctx.has("mailboxes:manage") }] : []),
    ...[...ctx.firms.values()].map((f) => ({ id: f.firmId, firmId: f.firmId as string | null, name: f.tradingName, manage: f.permissions.has("firm:manage") || ctx.has("mailboxes:manage") })),
  ];
  const rows = await Promise.all(practices.map(async (p) => ({ ...p, sigs: await getSignatures(ctx, p.firmId) })));
  const pick = (s: Awaited<ReturnType<typeof getSignatures>>["mine"]) =>
    s ? { fullName: s.fullName ?? "", role: s.role ?? "", phone: s.phone ?? "", email: s.email ?? "", website: s.website ?? "", bookingUrl: s.bookingUrl ?? "", disclaimer: s.disclaimer ?? "", showLogo: s.showLogo } : null;
  return (
    <>
      <PageHeader title="Signatures" description="Each email gets exactly one signature: yours for that practice if you've set one, otherwise the practice's. Contact details you leave blank fall back to the practice signature." />
      <div className="flex flex-col gap-5">
        {rows.map((p) => (
          <Panel key={p.id}>
            <PanelHeader title={p.name} />
            <div className="grid gap-6 p-4 xl:grid-cols-2">
              <SignatureEditor practice={p.id} which="mine" title="Your signature" initial={pick(p.sigs.mine) ?? { fullName: ctx.user.name, role: "", phone: "", email: "", website: "", bookingUrl: "", disclaimer: "", showLogo: true }} />
              {p.manage ? (
                <SignatureEditor practice={p.id} which="practice" title="Practice signature (default for everyone)" initial={pick(p.sigs.practice) ?? { fullName: "", role: "", phone: "", email: "", website: "", bookingUrl: "", disclaimer: "", showLogo: true }} />
              ) : (
                <div className="text-[13px] text-muted">The practice signature is managed by the practice&apos;s administrators.{p.sigs.practice ? " It fills any contact details you leave blank." : ""}</div>
              )}
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
