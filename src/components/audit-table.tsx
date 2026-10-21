import Link from "next/link";
import { LocalTime } from "./ui/forms";
import { Button, EmptyState, tableClass as t } from "./ui/primitives";

type Event = { id: number; action: string; summary: string | null; createdAt: Date; ip: string | null; actorName: string | null; firmName: string | null };

const ACTION_LABELS: Record<string, string> = {
  "auth.signed_in": "Signed in", "auth.sign_in_failed": "Sign-in failed", "auth.signed_out": "Signed out", "auth.mfa_enabled": "Two-step sign-in turned on",
  "auth.mfa_disabled": "Two-step sign-in turned off", "auth.mfa_verified": "Two-step code accepted", "auth.mfa_recovery_code_used": "Recovery code used",
  "auth.password_reset_requested": "Password reset requested", "auth.password_reset": "Password reset", "auth.password_changed": "Password changed",
};

export function AuditTable({ events, basePath, showFirm }: { events: Event[]; basePath: string; showFirm: boolean }) {
  if (!events.length) return <EmptyState title="No audit events yet" />;
  return (
    <>
      <div className={t.wrap}>
        <table className={t.table}>
          <thead><tr><th className={t.th}>When</th><th className={t.th}>Who</th>{showFirm ? <th className={t.th}>Firm</th> : null}<th className={t.th}>What happened</th><th className={t.th}>IP address</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className={t.row}>
                <td className={`${t.td} whitespace-nowrap text-ink-2`}><LocalTime value={e.createdAt} /></td>
                <td className={t.td}>{e.actorName ?? <span className="text-muted">System</span>}</td>
                {showFirm ? <td className={t.td}>{e.firmName ?? <span className="text-muted">Hub</span>}</td> : null}
                <td className={t.td}>
                  <div className="text-ink">{e.summary ?? ACTION_LABELS[e.action] ?? e.action}</div>
                  <div className="text-xs text-muted">{e.action}</div>
                </td>
                <td className={`${t.td} num text-xs text-muted`}>{e.ip ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {events.length === 100 ? (
        <div className="px-3 py-2.5"><Button asChild size="sm"><Link href={`${basePath}?before=${events.at(-1)!.id}`}>Older entries</Link></Button></div>
      ) : null}
    </>
  );
}
