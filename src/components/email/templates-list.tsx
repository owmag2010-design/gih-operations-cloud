import Link from "next/link";
import { Plus } from "lucide-react";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, EmptyState, Panel, tableClass as t } from "@/components/ui/primitives";
import type { emailTemplates } from "@/server/db/schema";

export function TemplatesList({ base, templates, canEdit, showHub }: { base: string; templates: (typeof emailTemplates.$inferSelect)[]; canEdit: boolean; showHub: boolean }) {
  return (
    <Panel>
      {canEdit ? (
        <div className="flex justify-end border-b border-hairline p-3">
          <Button asChild variant="primary" size="sm"><Link href={`${base}/templates/new`}><Plus /> New template</Link></Button>
        </div>
      ) : null}
      {templates.length === 0 ? (
        <EmptyState title="No templates yet">Templates are branded emails you can send in two clicks, with the client&apos;s details filled in.</EmptyState>
      ) : (
        <div className={t.wrap}>
          <table className={t.table}>
            <thead><tr><th className={t.th}>Template</th><th className={t.th}>Group</th><th className={t.th}>Subject</th><th className={t.th}>Updated</th></tr></thead>
            <tbody>
              {templates.map((x) => (
                <tr key={x.id} className={t.row}>
                  <td className={t.td}>
                    <Link href={`${base}/templates/${x.id}`} className="text-ink underline-offset-2 hover:underline">{x.name}</Link>
                    {showHub && x.firmId === null ? <Badge tone="outline" className="ml-1.5">Hub</Badge> : null}
                    {x.isActive ? null : <Badge tone="warn" className="ml-1.5">Off</Badge>}
                  </td>
                  <td className={`${t.td} text-ink-2`}>{x.category}</td>
                  <td className={`${t.td} max-w-[360px] truncate text-ink-2`}>{x.subject}</td>
                  <td className={`${t.td} text-muted`}><LocalTime value={x.updatedAt} mode="date" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
