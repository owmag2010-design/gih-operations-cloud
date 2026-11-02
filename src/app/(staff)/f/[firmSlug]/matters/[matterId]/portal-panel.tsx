import { LocalTime } from "@/components/ui/forms";
import { Badge, Notice, Panel, PanelHeader } from "@/components/ui/primitives";
import type { AccessContext } from "@/server/access/context";
import { getPortalPanel } from "@/server/modules/portal/portal";
import { AddChecklistDialog, ChecklistStatus, CopyLink, DriveFolderForm, OpenPortalDialog, PortalButtons, RetryDrive, StaffComposer } from "./portal-client";

const ITEM_TONE = { needed: "warn", uploaded: "accent", accepted: "ok", waived: "neutral" } as const;
const ITEM_LABEL = { needed: "Needed", uploaded: "Received", accepted: "Accepted", waived: "Not needed" } as const;
const DRIVE_LABEL: Record<string, [string, "ok" | "warn" | "neutral" | "danger"]> = {
  uploaded: ["In Drive", "ok"],
  pending: ["Sending to Drive", "neutral"],
  failed: ["Drive failed", "danger"],
  not_configured: ["Drive not connected", "warn"],
  no_folder: ["No Drive folder", "warn"],
};

/** The client portal for this matter: link, checklist, messages and uploads. */
export async function PortalPanel({ ctx, firmId, slug, matterId }: { ctx: AccessContext; firmId: string; slug: string; matterId: string }) {
  const p = await getPortalPanel(ctx, firmId, matterId);
  const open = !!p.access;
  const unanswered = (() => {
    const lastClient = [...p.messages].reverse().find((m) => m.authorKind === "client");
    const lastStaff = [...p.messages].reverse().find((m) => m.authorKind === "staff" && !m.internal);
    return !!lastClient && (!lastStaff || lastStaff.createdAt < lastClient.createdAt);
  })();
  const needed = p.checklist.filter((i) => i.status === "needed").length;

  return (
    <Panel id="portal">
      <PanelHeader
        title="Client portal"
        description={open ? <>Open for {p.access!.email}{p.access!.lastSeenAt ? <> · last visit <LocalTime value={p.access!.lastSeenAt} mode="relative" /></> : " · not opened yet"}</> : "A private page where the client follows the matter, uploads documents and messages the team."}
        actions={
          p.canEdit ? (open ? <OpenPortalDialog slug={slug} matterId={matterId} email={p.access!.email} replace /> : <OpenPortalDialog slug={slug} matterId={matterId} email={p.client?.email ?? ""} />) : null
        }
      />
      <div className="flex flex-col gap-5 px-4 py-4">
        {open ? (
          <div className="flex flex-col gap-3">
            {p.access!.link ? <CopyLink link={p.access!.link} /> : <Notice tone="warn">The link can&apos;t be shown. Replace it to issue a new one.</Notice>}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {p.access!.invitedAt ? <Badge tone="ok">Invited <LocalTime value={p.access!.invitedAt} mode="relative" /></Badge> : <Badge tone="warn">Invitation not emailed</Badge>}
              {unanswered ? <Badge tone="danger">Client waiting for a reply</Badge> : null}
              {needed ? <Badge tone="warn">{needed} document{needed === 1 ? "" : "s"} outstanding</Badge> : null}
            </div>
            {p.canEdit ? <PortalButtons slug={slug} matterId={matterId} /> : null}
            {p.canEdit ? <DriveFolderForm slug={slug} matterId={matterId} current={p.access!.driveFolderId} /> : null}
            {!p.driveConnected ? <Notice tone="neutral">Google Drive isn&apos;t connected yet, so uploads stay on this matter only. Add the service account key to switch it on.</Notice> : null}
          </div>
        ) : null}

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-ink">Document checklist</h3>
            {p.canEdit ? <AddChecklistDialog slug={slug} matterId={matterId} /> : null}
          </div>
          {p.checklist.length ? (
            <ul className="divide-y divide-hairline rounded-lg border border-hairline text-[13px]">
              {p.checklist.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    {i.groupLabel ? <span className="mr-1.5 text-xs text-muted">{i.groupLabel} ·</span> : null}
                    <span className="text-ink">{i.label}</span>
                  </span>
                  {p.canEdit ? <ChecklistStatus slug={slug} matterId={matterId} itemId={i.id} status={i.status} /> : <Badge tone={ITEM_TONE[i.status]}>{ITEM_LABEL[i.status]}</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No checklist yet. Add the documents the client must provide; they see them in the portal with an upload button each.</p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-[13px] font-semibold text-ink">Messages</h3>
          {p.messages.length ? (
            <ul className="flex flex-col gap-2.5">
              {p.messages.map((m) => (
                <li key={m.id} className={`rounded-lg px-3 py-2 text-[13px] ${m.internal ? "border border-dashed border-hairline-strong bg-sunken" : m.authorKind === "client" ? "border-l-[3px] border-danger/60 bg-surface" : "bg-sunken"}`}>
                  <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="font-medium text-ink">{m.authorName}</span>
                    {m.internal ? <Badge tone="neutral">Internal</Badge> : m.authorKind === "client" ? <Badge tone="accent">Client</Badge> : null}
                    <LocalTime value={m.createdAt} mode="relative" />
                  </p>
                  <p className="whitespace-pre-wrap text-ink-2">{m.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No messages yet.</p>
          )}
          {p.canEdit ? <StaffComposer slug={slug} matterId={matterId} portalOpen={open} /> : null}
        </section>

        {p.uploads.length ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-ink">Client uploads</h3>
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {p.uploads.map((u) => {
                const [label, tone] = DRIVE_LABEL[u.driveStatus] ?? ["", "neutral"];
                return (
                  <li key={u.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <a href={`/f/${slug}/documents/files/${u.documentFileId}`} className="underline-offset-2 hover:underline">{u.filename}</a>
                      <span className="ml-2 text-xs text-muted">{Math.max(1, Math.round(u.size / 1024))} KB · <LocalTime value={u.createdAt} mode="relative" /></span>
                    </span>
                    <span className="flex items-center gap-2">
                      {u.driveFileId ? <a className="text-xs underline-offset-2 hover:underline" href={`https://drive.google.com/file/d/${u.driveFileId}/view`} target="_blank" rel="noreferrer"><Badge tone={tone}>{label}</Badge></a> : <Badge tone={tone} title={u.driveError ?? undefined}>{label}</Badge>}
                      {p.canEdit && open && u.driveStatus !== "uploaded" && p.driveConnected && p.access!.driveFolderId ? <RetryDrive slug={slug} matterId={matterId} uploadId={u.id} /> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </Panel>
  );
}
