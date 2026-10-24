import type { Metadata } from "next";
import { CalendarPlus, Lock, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ComposeDialog } from "@/components/email/client";
import { EventDialog } from "@/components/work/calendar";
import { NotesPanel } from "@/components/work/notes";
import { TaskDialog, TaskList } from "@/components/work/tasks";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, cn, EmptyState, Facts, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { FACT_BASIS, fullName, MATTER_PERSON_ROLES } from "@/lib/labels";
import { NotFoundError } from "@/server/errors";
import { daysBetween } from "@/server/modules/matters/dates";
import { getMatter, matterFormOptions } from "@/server/modules/matters/matters";
import { listNotes } from "@/server/modules/notes/notes";
import { listTasks, taskFormOptions } from "@/server/modules/tasks/tasks";
import { requireFirm } from "@/server/next/session";
import { DocumentsPanel } from "../../documents/matter-panel";
import { Timeline } from "../../timeline";
import {
  AdjustDateDialog, CompleteDateButton, DateDialogs, EditMatterDialog, FactDialog, PersonDialog, RemoveFactButton, RemovePersonButton, StageBar, TeamControls, VerifyFactDialog,
} from "./client";

export const metadata: Metadata = { title: "Matter" };

const BASIS_TONE = { verified: "ok", client_statement: "neutral", staff_assessment: "accent" } as const;
const DATE_KIND: Record<string, string> = { deadline: "Deadline", expiry: "Expiry", submission: "Submission", other: "Date" };

export default async function MatterPage({ params, searchParams }: PageProps<"/f/[firmSlug]/matters/[matterId]">) {
  const { firmSlug, matterId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  const view = await getMatter(ctx, firm.firmId, matterId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { matter, client, stage, stages, service, proposal, people, facts, dates, events, timeline, team, rules } = view;
  const sp = await searchParams;
  const base = `/f/${firm.slug}`;
  const canEdit = ctx.has("matters:edit", firm.firmId);
  const [taskRows, options, notes, teamOptions] = await Promise.all([
    listTasks(ctx, { view: "all", status: "all", matterId: matter.id }),
    taskFormOptions(ctx),
    listNotes(ctx, firm.firmId, { matterId: matter.id }),
    ctx.has("matters:create", firm.firmId) ? matterFormOptions(ctx, firm.firmId).then((o) => o.team) : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const teamList = teamOptions.length ? teamOptions : options.people.filter((p) => p.firmId === firm.firmId).map((p) => ({ id: p.id, name: p.name }));
  const tasks = taskRows.filter((t) => t.status !== "cancelled").map((t) => ({ ...t, dueAt: t.dueAt?.toISOString() ?? null, reminderAt: t.reminderAt?.toISOString() ?? null, completedAt: t.completedAt?.toISOString() ?? null }));
  const peopleNames = people.map((p) => ({ id: p.id, name: fullName(p.firstName, p.lastName) }));
  const nameOfPerson = (id: string | null) => (id ? peopleNames.find((p) => p.id === id)?.name : null);
  const today = new Date().toISOString().slice(0, 10);
  const canRestrict = ctx.has("firm:manage", firm.firmId) || matter.caseManagerId === ctx.user.id;
  const label = `${matter.ref}: ${matter.title}`;
  const templated = timeline.filter((a) => a.type === "task" && /from the practice's templates/.test(a.body ?? "")).reduce((n, a) => n + (Number(/^(\d+)/.exec(a.body ?? "")?.[1]) || 0), 0);
  const closed = stage.category === "closed";

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-muted">
        <Link href={`${base}/matters`} className="hover:text-ink">Matters</Link> <span aria-hidden="true">/</span>{" "}
        <Link href={`${base}/clients/${client.id}`} className="hover:text-ink">{fullName(client.firstName, client.lastName)}</Link> <span aria-hidden="true">/</span> <span className="num">{matter.ref}</span>
      </nav>
      <PageHeader
        title={matter.title}
        meta={
          <>
            <Badge tone={closed ? "outline" : "accent"}>{stage.name}</Badge>
            {matter.restricted ? <Badge tone="warn"><Lock className="size-3" /> Restricted</Badge> : null}
            {matter.risk !== "low" ? <Badge tone={matter.risk === "high" ? "danger" : "warn"} className="capitalize">{matter.risk} risk</Badge> : null}
            {service ? <span className="text-[13px] text-muted">{service.name}</span> : null}
          </>
        }
        actions={
          <>
            {ctx.has("email:send", firm.firmId) ? <ComposeDialog firmId={firm.firmId} target={{ clientId: client.id }} to={client.email} /> : null}
            <EventDialog practices={[]} fixed={{ firmId: firm.firmId, matterId: matter.id, label }} trigger={<Button><CalendarPlus /> Schedule</Button>} />
            <TaskDialog options={options} meId={ctx.user.id} fixed={{ firmId: firm.firmId, matterId: matter.id, label }} trigger={<Button><Plus /> Task</Button>} />
            {canEdit ? <EditMatterDialog slug={firm.slug} matter={matter} team={teamList} canRestrict={canRestrict} /> : null}
          </>
        }
      />
      {sp.opened ? <Notice tone="ok" className="mb-4">Matter {matter.ref} opened.{templated ? ` ${templated} task${templated === 1 ? "" : "s"} added from the practice's templates.` : ""}</Notice> : null}

      <Panel className="mb-5 px-3 py-2">
        <StageBar slug={firm.slug} matterId={matter.id} stages={stages.map((s) => ({ id: s.id, name: s.name, category: s.category }))} currentId={matter.stageId} canEdit={canEdit} />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel>
            <PanelHeader title="Applicants and dependants" actions={canEdit ? <PersonDialog slug={firm.slug} matterId={matter.id} roles={MATTER_PERSON_ROLES} /> : null} />
            <ul className="divide-y divide-hairline">
              {people.map((p) => {
                const name = fullName(p.firstName, p.lastName);
                const soon = (d: string | null) => d && daysBetween(today, d) <= 90;
                return (
                  <li key={p.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{name} <span className="ml-1 text-xs font-normal text-muted">{MATTER_PERSON_ROLES[p.role]}</span></p>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        {p.dateOfBirth ? <span>Born <span className="num">{p.dateOfBirth}</span></span> : null}
                        {p.nationality ? <span>{countryName(p.nationality)}</span> : null}
                        {p.immigrationStatus ? <span>{p.immigrationStatus}{p.statusExpiresOn ? <> until <span className={cn("num", soon(p.statusExpiresOn) && "font-semibold text-danger")}>{p.statusExpiresOn}</span></> : null}</span> : null}
                        {p.passportExpiresOn ? <span>Passport to <span className={cn("num", soon(p.passportExpiresOn) && "font-semibold text-danger")}>{p.passportExpiresOn}</span></span> : null}
                      </p>
                    </div>
                    {canEdit ? <div className="flex items-center"><PersonDialog slug={firm.slug} matterId={matter.id} person={p} roles={MATTER_PERSON_ROLES} /><RemovePersonButton slug={firm.slug} matterId={matter.id} personId={p.id} name={name} /></div> : null}
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader title="Deadlines and key dates" description="Each date shows where it comes from." actions={canEdit ? <DateDialogs slug={firm.slug} matterId={matter.id} people={peopleNames} rules={rules} canManageRules={ctx.has("firm:manage", firm.firmId)} settingsHref={`${base}/settings/matters#rules`} /> : null} />
            {dates.length ? (
              <ul className="divide-y divide-hairline">
                {dates.map((d) => {
                  const left = daysBetween(today, d.dueOn);
                  const urgent = !d.completedAt && left <= 14;
                  return (
                    <li key={d.id} className={cn("flex flex-wrap items-start gap-3 px-4 py-3", d.completedAt && "opacity-60")}>
                      <div className={cn("w-[92px] shrink-0 rounded-xl px-2 py-1.5 text-center", urgent ? "bg-danger-soft text-danger" : "bg-sunken text-ink")}>
                        <p className="num text-[13px] font-semibold">{d.dueOn}</p>
                        <p className="text-[11px]">{d.completedAt ? "Done" : left < 0 ? `${-left} days ago` : left === 0 ? "Today" : `in ${left} days`}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">{d.label} <span className="ml-1 text-xs font-normal text-muted">{DATE_KIND[d.kind]}{nameOfPerson(d.personId) ? ` · ${nameOfPerson(d.personId)}` : ""}</span></p>
                        <p className="mt-0.5 text-xs text-ink-2">
                          <Badge tone={d.basisKind === "recorded" ? "neutral" : d.basisKind === "calculated" ? "accent" : "warn"} className="mr-1.5 capitalize">{d.basisKind}</Badge>
                          {d.basisKind === "adjusted" ? <>{d.adjustmentReason} <span className="text-muted">(reviewed by {d.reviewedBy ?? "unknown"})</span></> : d.basis}
                        </p>
                      </div>
                      {canEdit ? <div className="flex">{!d.completedAt ? <AdjustDateDialog slug={firm.slug} matterId={matter.id} dateId={d.id} current={d.dueOn} label={d.label} /> : null}<CompleteDateButton slug={firm.slug} matterId={matter.id} dateId={d.id} done={!!d.completedAt} /></div> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No dates yet">Add expiry dates from passports and visas, submission dates, and deadlines from letters or validated rules.</EmptyState>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Facts" description="Verified facts, what the client told you and staff assessments are kept apart." actions={canEdit ? <FactDialog slug={firm.slug} matterId={matter.id} people={peopleNames} basisLabels={{ client_statement: FACT_BASIS.client_statement, staff_assessment: FACT_BASIS.staff_assessment, verified: FACT_BASIS.verified }} /> : null} />
            {facts.length ? (
              <ul className="divide-y divide-hairline">
                {facts.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <Badge tone={BASIS_TONE[f.basis]} className="mt-0.5 w-[120px] justify-center">{FACT_BASIS[f.basis]}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-muted">{f.label}{nameOfPerson(f.personId) ? ` · ${nameOfPerson(f.personId)}` : ""}{f.sensitive ? <Badge tone="warn" className="ml-2">Sensitive</Badge> : null}</p>
                      <p className="text-sm whitespace-pre-wrap text-ink">{f.value}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {f.basis === "verified" ? <>Verified against {f.evidence} by {f.verifiedBy ?? "unknown"}{f.verifiedAt ? <> · <LocalTime value={f.verifiedAt} mode="date" /></> : null}</> : <>Recorded by {f.recordedBy ?? "unknown"}{f.evidence ? ` · ${f.evidence}` : ""}</>}
                      </p>
                    </div>
                    {canEdit ? <div className="flex">{f.basis !== "verified" ? <VerifyFactDialog slug={firm.slug} matterId={matter.id} factId={f.id} label={f.label} /> : null}<RemoveFactButton slug={firm.slug} matterId={matter.id} factId={f.id} label={f.label} /></div> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No facts recorded">Record facts with their basis, then verify client statements against documents as they arrive.</EmptyState>
            )}
          </Panel>

          <Panel id="tasks">
            <PanelHeader title="Tasks" actions={<Link href={`/tasks?view=team`} className="text-[13px] text-ink-2 hover:text-ink">All tasks →</Link>} />
            <TaskList tasks={tasks} options={options} meId={ctx.user.id} showPractice={false} empty="No tasks on this matter. Add one, or set up task templates by stage in Settings." />
          </Panel>

          <DocumentsPanel ctx={ctx} firmId={firm.firmId} slug={firm.slug} link={{ matterId: matter.id }} />

          <Panel>
            <PanelHeader title="Notes" />
            <NotesPanel
              slug={firm.slug}
              subject={{ matterId: matter.id }}
              notes={notes.map((n) => ({ id: n.id, body: n.body, visibility: n.visibility, version: n.version, author: n.author, editor: n.editor, authorId: n.authorId, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString() }))}
              canWrite={canEdit}
              canModerate={ctx.has("firm:manage", firm.firmId)}
              meId={ctx.user.id}
            />
          </Panel>

          <Panel>
            <PanelHeader title="Activity" description="Internal: never shown to the client." />
            <Timeline items={timeline.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))} />
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader title="Details" />
            <div className="p-4">
              <Facts
                items={[
                  ["Client", <Link key="c" href={`${base}/clients/${client.id}`} className="text-ink underline-offset-2 hover:underline">{fullName(client.firstName, client.lastName)}</Link>],
                  ["Reference", <span key="r" className="num">{matter.ref}</span>],
                  ["Service", service?.name],
                  ["Legal category", matter.legalCategory],
                  ["Jurisdiction", countryName(matter.jurisdiction)],
                  ["Proposal", proposal ? <Link key="p" href={`${base}/proposals/${proposal.id}`} className="num text-ink underline-offset-2 hover:underline">{proposal.ref}</Link> : null],
                  ["Submitted", matter.submittedOn ? `${matter.submittedOn}${matter.submissionChannel ? ` via ${matter.submissionChannel}` : ""}` : null],
                  ["Submission ref.", matter.submissionReference],
                  ["Outcome", matter.outcome],
                  ["Opened", <LocalTime key="o" value={matter.openedAt} mode="date" />],
                  ["Closed", matter.closedAt ? <LocalTime key="cl" value={matter.closedAt} mode="date" /> : null],
                ]}
              />
              {matter.riskNote ? <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">{matter.riskNote}</p> : null}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Team" description={matter.restricted ? "Only these people and practice administrators can see this matter." : undefined} />
            <div className="flex flex-col gap-3 p-4 text-[13px]">
              <p><span className="text-muted">Case manager</span><br /><span className="font-medium text-ink">{team.caseManager?.name ?? "None"}</span></p>
              <p><span className="text-muted">Consultant</span><br /><span className="font-medium text-ink">{team.consultant?.name ?? "None"}</span></p>
              <div>
                <p className="mb-1 text-muted">Also on the team</p>
                {canEdit ? <TeamControls slug={firm.slug} matterId={matter.id} members={team.members.map((m) => ({ userId: m.userId, name: m.name }))} candidates={teamList.filter((u) => u.id !== matter.caseManagerId && u.id !== matter.consultantId)} /> : team.members.length ? team.members.map((m) => <p key={m.userId} className="text-ink">{m.name}</p>) : <p className="text-muted">Nobody else</p>}
              </div>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Appointments" actions={<Link href="/calendar" className="text-[13px] text-ink-2 hover:text-ink">Calendar →</Link>} />
            {events.length ? (
              <ul className="divide-y divide-hairline">
                {events.map((e) => (
                  <li key={e.id} className="px-4 py-2.5">
                    <p className="text-sm font-medium text-ink">{e.title}</p>
                    <p className="text-xs text-muted capitalize">{e.kind} · <LocalTime value={e.startsAt} />{e.location ? ` · ${e.location}` : ""}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="p-4 text-[13px] text-muted">Nothing scheduled.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
