import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, EmptyState, PageHeader, Panel, tableClass as t } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { fullName } from "@/lib/labels";
import { listClients } from "@/server/modules/clients/clients";
import { requireFirm } from "@/server/next/session";
import { ClientSearch } from "./search";

export const metadata: Metadata = { title: "Clients" };

const STATUS: Record<string, "ok" | "neutral" | "outline"> = { active: "ok", inactive: "neutral", archived: "outline" };

export default async function ClientsPage({ params, searchParams }: PageProps<"/f/[firmSlug]/clients">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("clients:view_all", firm.firmId) && !ctx.has("clients:view_assigned", firm.firmId)) notFound();
  const sp = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v : undefined);
  const filters = { q: one(sp.q), status: one(sp.status), consultant: one(sp.consultant), page: Number(one(sp.page)) || 1 };
  const data = await listClients(ctx, firm.firmId, filters);
  const base = `/f/${firm.slug}/clients`;
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...filters, page: undefined, ...over }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return p.toString() ? `?${p}` : "";
  };

  return (
    <>
      <PageHeader
        title="Clients"
        description={`${data.total.toLocaleString("en-ZA")} ${filters.status ?? "active"} client${data.total === 1 ? "" : "s"}${filters.q ? ` matching “${filters.q}”` : ""}.`}
        actions={
          <>
            {ctx.has("clients:export", firm.firmId) ? <Button asChild><a href={`${base}/export${filters.status ? `?status=${filters.status}` : ""}`} download>Export CSV</a></Button> : null}
            {ctx.has("clients:create", firm.firmId) ? <Button asChild variant="primary"><Link href={`${base}/new`}>New client</Link></Button> : null}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ClientSearch initial={filters.q ?? ""} />
        <nav aria-label="Status" className="flex rounded-md border border-hairline bg-surface p-0.5 text-[13px]">
          {[["", "Active"], ["inactive", "Inactive"], ["archived", "Archived"]].map(([v, l]) => (
            <Link key={l} href={`${base}${qs({ status: v || undefined })}`} aria-current={(filters.status ?? "") === v ? "true" : undefined} className={`rounded px-2.5 py-1 ${(filters.status ?? "") === v ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink"}`}>{l}</Link>
          ))}
        </nav>
        <Link href={`${base}${qs({ consultant: filters.consultant === "me" ? undefined : "me" })}`} className={`rounded-md border px-2.5 py-1 text-[13px] ${filters.consultant === "me" ? "border-accent/50 bg-accent-soft/50 text-accent" : "border-hairline bg-surface text-muted hover:text-ink"}`}>
          My clients
        </Link>
      </div>
      <Panel>
        {data.rows.length === 0 ? (
          <EmptyState title={filters.q || filters.consultant ? "No clients match" : "No clients yet"}>
            {filters.q || filters.consultant ? "Try a different search." : "Clients appear here when a lead is converted, or when your team adds one directly."}
          </EmptyState>
        ) : (
          <div className={t.wrap}>
            <table className={t.table}>
              <thead><tr><th className={t.th}>Name</th><th className={t.th}>Contact</th><th className={t.th}>Nationality</th><th className={t.th}>Lives in</th><th className={t.th}>Consultant</th><th className={t.th}>Status</th><th className={t.th}>Client since</th></tr></thead>
              <tbody>
                {data.rows.map((c) => (
                  <tr key={c.id} className={t.row}>
                    <td className={t.td}>
                      <Link href={`${base}/${c.id}`} className="font-medium text-ink hover:underline">{fullName(c.firstName, c.lastName)}</Link>
                      <div className="num text-xs text-muted">{c.ref}</div>
                    </td>
                    <td className={`${t.td} text-ink-2`}>{c.email ?? c.phone}</td>
                    <td className={t.td}>{countryName(c.nationality)}</td>
                    <td className={t.td}>{countryName(c.countryOfResidence)}</td>
                    <td className={t.td}>{c.consultantName ?? <span className="text-muted">None</span>}</td>
                    <td className={t.td}><Badge tone={STATUS[c.status]} className="capitalize">{c.status}</Badge></td>
                    <td className={`${t.td} text-ink-2`}><LocalTime value={c.createdAt} mode="date" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.total > data.pageSize ? (
          <div className="flex items-center justify-between px-3 py-2.5 text-[13px] text-muted">
            <span className="num">Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span>
            <div className="flex gap-1">
              {data.page > 1 ? <Button asChild size="sm"><Link href={`${base}${qs({ page: String(data.page - 1) })}`}>Previous</Link></Button> : null}
              {data.page * data.pageSize < data.total ? <Button asChild size="sm"><Link href={`${base}${qs({ page: String(data.page + 1) })}`}>Next</Link></Button> : null}
            </div>
          </div>
        ) : null}
      </Panel>
    </>
  );
}
