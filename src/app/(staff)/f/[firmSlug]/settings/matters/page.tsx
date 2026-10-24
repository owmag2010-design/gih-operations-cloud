import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/ui/forms";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { listDeadlineRules, listStageSets } from "@/server/modules/matters/matters";
import { listTaskTemplates } from "@/server/modules/tasks/tasks";
import { requireFirm } from "@/server/next/session";
import { DeadlineRuleForm, MatterStageEditor, RuleValidation, TaskTemplateForm, TemplateToggle } from "./client";

export const metadata: Metadata = { title: "Matter settings" };

const ASSIGN: Record<string, string> = { case_manager: "Case manager", consultant: "Consultant", unassigned: "Team" };

export default async function MatterSettingsPage({ params }: PageProps<"/f/[firmSlug]/settings/matters">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  const canManage = ctx.has("firm:manage", firm.firmId);
  const [{ stages, services }, templates, rules] = await Promise.all([listStageSets(ctx, firm.firmId), listTaskTemplates(ctx, firm.firmId), listDeadlineRules(ctx, firm.firmId)]);
  const defaults = stages.filter((s) => !s.serviceId);
  const byService = services.map((svc) => ({ svc, stages: stages.filter((s) => s.serviceId === svc.id) })).filter((x) => x.stages.length);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-muted"><Link href={`/f/${firm.slug}/settings`} className="hover:text-ink">Settings</Link> <span aria-hidden="true">/</span> Matters</nav>
      <PageHeader title="Matter settings" description={canManage ? "Stages, task templates and deadline rules for this practice's matters." : "Only practice administrators can change these."} />
      <div className="flex flex-col gap-5">
        <Panel>
          <PanelHeader title="Stages" description="The default stages every matter follows. Hidden stages stay on old matters but can't be chosen." />
          <MatterStageEditor slug={firm.slug} stages={defaults} serviceId={null} canManage={canManage} />
        </Panel>
        {byService.map(({ svc, stages: list }) => (
          <Panel key={svc.id}>
            <PanelHeader title={`Stages for ${svc.name}`} description="Matters for this service follow these stages instead of the defaults." />
            <MatterStageEditor slug={firm.slug} stages={list} serviceId={svc.id} canManage={canManage} />
          </Panel>
        ))}
        {canManage && services.length ? (
          <Panel>
            <PanelHeader title="Stages for a particular service" description="Give a service its own stages. The first stage you add starts a separate set for that service." />
            <div className="flex flex-wrap gap-2 p-4 text-[13px]">
              {services.filter((s) => !byService.some((b) => b.svc.id === s.id)).map((s) => (
                <details key={s.id} className="w-full rounded-xl border border-hairline">
                  <summary className="cursor-pointer px-4 py-2.5 text-ink">{s.name}</summary>
                  <MatterStageEditor slug={firm.slug} stages={[]} serviceId={s.id} canManage />
                </details>
              ))}
            </div>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader title="Task templates" description="Tasks created automatically when a matter opens or reaches a stage. Each template adds its task once per matter." />
          {templates.length ? (
            <ul className="divide-y divide-hairline">
              {templates.map((t) => (
                <li key={t.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${t.isActive ? "" : "opacity-60"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{t.title}</p>
                    <p className="text-xs text-muted">
                      {t.stageName ? `On reaching ${t.stageName}` : "When the matter opens"} · {t.serviceName ?? "every service"} · {ASSIGN[t.assignTo]}{t.dueOffsetDays !== null ? ` · due after ${t.dueOffsetDays} day${t.dueOffsetDays === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  {t.priority !== "normal" ? <Badge tone={t.priority === "urgent" ? "danger" : t.priority === "high" ? "warn" : "neutral"} className="capitalize">{t.priority}</Badge> : null}
                  {!t.isActive ? <Badge tone="outline">Off</Badge> : null}
                  {canManage ? <TemplateToggle slug={firm.slug} t={t} /> : null}
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No task templates yet">Add the tasks your team does on every matter, such as sending the welcome pack or requesting documents.</EmptyState>}
          {canManage ? <TaskTemplateForm slug={firm.slug} stages={stages.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name, serviceName: s.serviceName }))} services={services} /> : null}
        </Panel>

        <Panel id="rules">
          <PanelHeader title="Deadline rules" description="Rules your practice has checked against their source. A rule can be used to calculate deadlines only after an administrator validates it; changing a rule clears its validation." />
          {rules.length ? (
            <ul className="divide-y divide-hairline">
              {rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{r.name} <span className="ml-1 text-xs font-normal text-muted">{r.jurisdiction}</span></p>
                    <p className="text-xs text-ink-2">{r.offsetDays} {r.businessDays ? "business" : "calendar"} days from {r.fromLabel}</p>
                    <p className="text-xs text-muted">Source: {r.source}</p>
                    <p className="mt-0.5 text-xs">{r.validatedAt ? <span className="text-ok">Validated by {r.validatedBy ?? "unknown"} · <LocalTime value={r.validatedAt} mode="date" /></span> : <span className="text-warn">{r.isActive ? "Not validated: can't be used yet" : "Withdrawn"}</span>}</p>
                  </div>
                  {canManage ? <RuleValidation slug={firm.slug} ruleId={r.id} validated={!!r.validatedAt} /> : null}
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No deadline rules">No rules are pre-loaded: add only rules your practice has checked, with their source. Until then, record deadlines as dates taken from the relevant letter.</EmptyState>}
          {canManage ? <DeadlineRuleForm slug={firm.slug} /> : null}
        </Panel>
      </div>
    </>
  );
}
