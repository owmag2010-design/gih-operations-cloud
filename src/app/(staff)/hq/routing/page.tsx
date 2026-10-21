import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { listRules } from "@/server/modules/intake/intake";
import { listFirms } from "@/server/modules/org/firms";
import { requireStaff } from "@/server/next/session";
import { RulePreview, RulesEditor } from "./client";

export const metadata: Metadata = { title: "Routing rules" };

export default async function RoutingPage() {
  const { ctx } = await requireStaff();
  if (!ctx.has("routing:manage") && !ctx.has("intake:view")) notFound();
  const [rules, firms] = await Promise.all([listRules(ctx), listFirms(ctx)]);
  const canManage = ctx.has("routing:manage");
  return (
    <>
      <PageHeader title="Routing rules" description="Checked from the top for every new enquiry; the first rule that matches suggests the firm. A person confirms before anything is routed." />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Panel>
          <PanelHeader title="Rules, in order" description={canManage ? undefined : "Only group super administrators can change these."} />
          <RulesEditor
            canManage={canManage}
            firms={firms.map((f) => ({ id: f.id, name: f.tradingName }))}
            rules={rules.map((r) => ({ id: r.id, name: r.name, action: r.action, targetFirmId: r.targetFirmId, flag: r.flag, isActive: r.isActive, keywords: r.match.keywordsAny ?? [], currentCountries: r.match.currentCountryIn ?? [], destinations: r.match.destinationIn ?? [] }))}
          />
        </Panel>
        <Panel className="self-start">
          <PanelHeader title="Try the rules" description="See which firm an enquiry would be suggested for. Nothing is saved." />
          <div className="p-4"><RulePreview firms={firms.map((f) => ({ id: f.id, name: f.tradingName }))} /></div>
        </Panel>
      </div>
    </>
  );
}
