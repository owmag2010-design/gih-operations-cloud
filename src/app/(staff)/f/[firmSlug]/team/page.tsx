import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader, tableClass as t } from "@/components/ui/primitives";
import { firmTeamAuthority } from "@/server/access/grants";
import { grantableFirmRoles, listFirmTeam, listPendingInvitations } from "@/server/modules/people/people";
import { requireFirm } from "@/server/next/session";
import { InviteDialog, RemoveMember, RevokeInvite, RoleSelect } from "./client";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ params }: PageProps<"/f/[firmSlug]/team">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("team:view", firm.firmId)) notFound();
  const [team, invites, roles] = await Promise.all([listFirmTeam(ctx, firm.firmId), listPendingInvitations(ctx, firm.firmId), grantableFirmRoles(ctx, firm.firmId)]);
  const canInvite = ctx.has("team:invite", firm.firmId) && roles.length > 0;
  const canManage = !!(await firmTeamAuthority(ctx, firm.firmId, "team:manage"));
  return (
    <>
      <PageHeader
        title="Team"
        description={`People with access to ${firm.tradingName}'s records. Access ends the moment someone is removed.`}
        actions={canInvite ? <InviteDialog firmSlug={firm.slug} roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description ?? "" }))} /> : null}
      />
      <Panel>
        <div className={t.wrap}>
          <table className={t.table}>
            <thead><tr><th className={t.th}>Person</th><th className={t.th}>Role</th><th className={t.th}>Two-step sign-in</th><th className={t.th}>Last signed in</th>{canManage ? <th className={t.th}><span className="sr-only">Actions</span></th> : null}</tr></thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.membershipId} className={t.row}>
                  <td className={t.td}>
                    <div className="font-medium text-ink">{m.name}{m.userId === ctx.user.id ? <span className="ml-1.5 text-xs font-normal text-muted">you</span> : null}</div>
                    <div className="text-xs text-muted">{[m.email, m.title, m.department].filter(Boolean).join(", ")}</div>
                  </td>
                  <td className={t.td}>
                    {canManage && m.userId !== ctx.user.id && m.status === "active" ? (
                      <RoleSelect firmSlug={firm.slug} membershipId={m.membershipId} roleId={m.roleId} roles={roles.map((r) => ({ id: r.id, name: r.name }))} currentName={m.roleName} />
                    ) : (
                      <Badge tone="outline">{m.roleName}</Badge>
                    )}
                  </td>
                  <td className={t.td}>{m.status === "deactivated" ? <Badge tone="danger">Account deactivated</Badge> : m.mfaEnabledAt ? <Badge tone="ok">On</Badge> : <Badge tone="warn">Off</Badge>}</td>
                  <td className={`${t.td} text-ink-2`}>{m.lastLoginAt ? <LocalTime value={m.lastLoginAt} mode="relative" /> : "Never"}</td>
                  {canManage ? <td className={`${t.td} text-right`}>{m.userId !== ctx.user.id ? <RemoveMember firmSlug={firm.slug} membershipId={m.membershipId} name={m.name} /> : null}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel className="mt-5">
        <PanelHeader title="Pending invitations" description="Invitation links expire after 7 days." />
        {invites.length === 0 ? (
          <EmptyState title="No pending invitations" />
        ) : (
          <ul className="divide-y divide-hairline">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                <span><span className="font-medium text-ink">{i.name}</span> <span className="text-muted">{i.email}, as {i.role}, expires <LocalTime value={i.expiresAt} mode="relative" /></span></span>
                {canInvite ? <RevokeInvite firmSlug={firm.slug} invitationId={i.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
