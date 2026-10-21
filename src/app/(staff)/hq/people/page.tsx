import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader, tableClass as t } from "@/components/ui/primitives";
import { listFirms } from "@/server/modules/org/firms";
import { grantableGroupRoles, listOrgStaff, listPendingInvitations, listRoles } from "@/server/modules/people/people";
import { requireStaff } from "@/server/next/session";
import { GroupRoleSelect, InviteStaffDialog, PersonActions, RevokeStaffInvite } from "./client";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage() {
  const { ctx } = await requireStaff();
  if (!ctx.has("staff:view")) notFound();
  const [staff, invites, groupRoles, firmRoles, firms] = await Promise.all([
    listOrgStaff(ctx), listPendingInvitations(ctx, null), grantableGroupRoles(ctx), listRoles(ctx, "firm"), listFirms(ctx),
  ]);
  const canManage = ctx.has("staff:manage");
  const canInvite = ctx.has("staff:invite");
  return (
    <>
      <PageHeader
        title="People"
        description="Everyone with a staff account. Group roles cover Hub work only; access to a firm's records comes from membership of that firm."
        actions={canInvite ? (
          <InviteStaffDialog
            groupRoles={groupRoles.map((r) => ({ id: r.id, name: r.name }))}
            firmRoles={canManage ? firmRoles.map((r) => ({ id: r.id, name: r.name })) : []}
            firms={firms.filter((f) => f.status === "active").map((f) => ({ id: f.id, name: f.tradingName }))}
          />
        ) : null}
      />
      <Panel>
        <div className={t.wrap}>
          <table className={t.table}>
            <thead><tr><th className={t.th}>Person</th><th className={t.th}>Group role</th><th className={t.th}>Firms</th><th className={t.th}>Two-step</th><th className={t.th}>Last signed in</th>{canManage ? <th className={t.th}><span className="sr-only">Actions</span></th> : null}</tr></thead>
            <tbody>
              {staff.map((p) => (
                <tr key={p.id} className={`${t.row} ${p.status === "deactivated" ? "opacity-60" : ""}`}>
                  <td className={t.td}>
                    <div className="font-medium text-ink">{p.name}{p.id === ctx.user.id ? <span className="ml-1.5 text-xs font-normal text-muted">you</span> : null}</div>
                    <div className="text-xs text-muted">{p.email}</div>
                  </td>
                  <td className={t.td}>
                    {canManage && p.id !== ctx.user.id && p.status === "active" ? (
                      <GroupRoleSelect userId={p.id} roleId={p.groupRoleId} roles={groupRoles.map((r) => ({ id: r.id, name: r.name }))} />
                    ) : p.groupRole ? <Badge tone="outline">{p.groupRole}</Badge> : <span className="text-muted">None</span>}
                  </td>
                  <td className={t.td}>
                    <div className="flex flex-wrap gap-1">{p.firms.length ? p.firms.map((f) => <Badge key={f.firmId} tone="neutral">{f.firm}: {f.role}</Badge>) : <span className="text-muted">None</span>}</div>
                  </td>
                  <td className={t.td}>{p.mfaEnabledAt ? <Badge tone="ok">On</Badge> : <Badge tone="warn">Off</Badge>}</td>
                  <td className={`${t.td} text-ink-2`}>{p.status === "deactivated" ? <Badge tone="danger">Deactivated</Badge> : p.lastLoginAt ? <LocalTime value={p.lastLoginAt} mode="relative" /> : "Never"}</td>
                  {canManage ? <td className={`${t.td} text-right`}>{p.id !== ctx.user.id ? <PersonActions userId={p.id} name={p.name} active={p.status !== "deactivated"} /> : null}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel className="mt-5">
        <PanelHeader title="Pending invitations" />
        {invites.length === 0 ? <EmptyState title="No pending invitations" /> : (
          <ul className="divide-y divide-hairline">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                <span><span className="font-medium text-ink">{i.name}</span> <span className="text-muted">{i.email}, as {i.role}{i.firm ? ` at ${i.firm}` : ""}, expires <LocalTime value={i.expiresAt} mode="relative" /></span></span>
                {canInvite || canManage ? <RevokeStaffInvite id={i.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
