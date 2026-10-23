import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, PageHeader, Panel, PanelHeader, tableClass as t } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/labels";
import { NotFoundError } from "@/server/errors";
import { getServiceWithHistory } from "@/server/modules/services/services";
import { requireFirm } from "@/server/next/session";
import { updateServiceAction } from "../../../actions";
import { ServiceForm } from "../service-form";

export const metadata: Metadata = { title: "Service" };

export default async function ServicePage({ params }: PageProps<"/f/[firmSlug]/settings/services/[serviceId]">) {
  const { firmSlug, serviceId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  const data = await getServiceWithHistory(ctx, firm.firmId, serviceId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { service, history } = data;
  const canEdit = ctx.has("services:manage", firm.firmId);
  const money = (m: number) => (m / 100).toFixed(m % 100 === 0 ? 0 : 2);

  return (
    <>
      <PageHeader
        title={service.name}
        description={<><Link href={`/f/${firmSlug}/settings#services`} className="underline-offset-2 hover:underline">Service catalogue</Link> · {service.category} · Version {history[0]?.version ?? 1}</>}
        meta={service.isActive ? undefined : <Badge tone="outline">Not offered</Badge>}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHeader title={canEdit ? "Edit fees" : "Fees"} description={canEdit ? "Saving creates a new price version. Proposals already sent keep the price they quoted." : "Only firm administrators and finance officers can change fees."} />
          <div className="p-4">
            {canEdit ? (
              <ServiceForm
                action={updateServiceAction.bind(null, firmSlug, service.id)}
                submitLabel="Save new version"
                initial={{
                  name: service.name, category: service.category, jurisdiction: service.jurisdiction, currency: service.currency,
                  deposit: money(service.depositMinor), isActive: service.isActive,
                  lines: service.lines.map((l) => ({ label: l.label, amount: money(l.amountMinor), kind: l.kind })),
                }}
              />
            ) : (
              <ul className="text-[13px]">
                {service.lines.map((l) => <li key={l.label} className="num flex justify-between border-b border-hairline py-1.5"><span>{l.label}</span><span>{formatMoney(l.amountMinor, service.currency)}</span></li>)}
                <li className="num flex justify-between py-1.5 font-medium"><span>Total</span><span>{formatMoney(service.totalMinor, service.currency)}</span></li>
              </ul>
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Price history" />
          <div className={t.wrap}>
            <table className={t.table}>
              <thead><tr><th className={t.th}>Version</th><th className={`${t.th} text-right`}>Total</th><th className={t.th}>Change</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className={t.row}>
                    <td className={`${t.td} num`}>v{h.version}</td>
                    <td className={`${t.td} num text-right`}>{formatMoney(h.totalMinor, h.currency)}<div className="text-xs text-muted">deposit {formatMoney(h.depositMinor, h.currency)}</div></td>
                    <td className={`${t.td} text-xs text-ink-2`}>{h.reason ?? "—"}<div className="text-muted">{h.changedBy ?? "Fee schedule"} · <LocalTime value={h.createdAt} mode="date" /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
