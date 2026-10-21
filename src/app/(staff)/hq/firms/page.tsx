import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FirmSwatch } from "@/components/shell/client";
import { Badge, Button, PageHeader, Panel, tableClass as t } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { listFirms } from "@/server/modules/org/firms";
import { requireStaff } from "@/server/next/session";
import { JoinFirmButton } from "./client";

export const metadata: Metadata = { title: "Firms" };

export default async function FirmsPage() {
  const { ctx } = await requireStaff();
  if (!ctx.has("firms:view")) notFound();
  const firms = await listFirms(ctx);
  return (
    <>
      <PageHeader
        title="Firms"
        description="Partner firms operating through Global Immigration Hub. Each is a separate business with its own records; membership is what grants access to them."
        actions={ctx.has("firms:create") ? <Button asChild variant="primary"><Link href="/hq/firms/new">Add a firm</Link></Button> : null}
      />
      <Panel>
        <div className={t.wrap}>
          <table className={t.table}>
            <thead><tr><th className={t.th}>Firm</th><th className={t.th}>Reference prefix</th><th className={t.th}>Jurisdictions</th><th className={t.th}>Shares counts with the Hub</th><th className={t.th}>Your access</th></tr></thead>
            <tbody>
              {firms.map((f) => {
                const member = ctx.firms.get(f.id);
                return (
                  <tr key={f.id} className={t.row}>
                    <td className={t.td}>
                      <span className="flex items-center gap-2.5">
                        <FirmSwatch color={f.brandColor} label={f.tradingName} />
                        <span><span className="block font-medium text-ink">{f.tradingName}</span><span className="block text-xs text-muted">{f.legalName}</span></span>
                      </span>
                    </td>
                    <td className={`${t.td} num`}>{f.refPrefix}</td>
                    <td className={t.td}>{f.jurisdictions.map(countryName).join(", ")}</td>
                    <td className={t.td}>{f.shareAggregateMetrics ? <Badge tone="ok">Yes</Badge> : <Badge tone="outline">No</Badge>}</td>
                    <td className={t.td}>
                      {member ? (
                        <span className="flex items-center gap-2"><Badge tone="outline">{member.roleName}</Badge><Link href={`/f/${f.slug}`} className="text-[13px] text-accent hover:underline">Open</Link></span>
                      ) : ctx.has("staff:manage") && f.allowGroupAdminAccess ? (
                        <JoinFirmButton firmId={f.id} name={f.tradingName} />
                      ) : (
                        <span className="text-xs text-muted">{f.allowGroupAdminAccess ? "No membership" : "No membership. The firm hasn't allowed Hub administrators to join."}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
