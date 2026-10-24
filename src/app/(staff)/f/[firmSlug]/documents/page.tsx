import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, EmptyState, Input, PageHeader, Panel, Select, cn, tableClass as t } from "@/components/ui/primitives";
import { canViewDocuments, KIND_LABEL, listDocuments } from "@/server/modules/documents/documents";
import { requireFirm } from "@/server/next/session";
import { DOC_STATUS } from "./labels";
import { DocumentTabs } from "./tabs";

export const metadata: Metadata = { title: "Documents" };

const FILTERS = [
  { key: "open", label: "In progress" }, { key: "review", label: "In review" }, { key: "mine", label: "Mine" }, { key: "final", label: "Final" }, { key: "all", label: "All" },
];

export default async function DocumentsPage({ params, searchParams }: PageProps<"/f/[firmSlug]/documents">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!canViewDocuments(ctx, firm.firmId)) notFound();
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "open";
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Number(sp.page) || 1;
  const { rows, total, pageSize } = await listDocuments(ctx, firm.firmId, { status: status === "all" || status === "mine" ? undefined : status, mine: status === "mine", kind, q, page });
  const base = `/f/${firm.slug}/documents`;
  const href = (o: Record<string, string | number>) => {
    const next = { status, kind, q, page: 1, ...o };
    const u = new URLSearchParams();
    if (next.status !== "open") u.set("status", String(next.status));
    if (next.kind) u.set("kind", String(next.kind));
    if (next.q) u.set("q", String(next.q));
    if (Number(next.page) > 1) u.set("page", String(next.page));
    return `${base}${u.size ? `?${u}` : ""}`;
  };
  return (
    <>
      <PageHeader
        title="Documents & Templates"
        description="Letters, reports, representations and packs, drafted from the practice's templates, reviewed by a second person and kept final once issued."
        actions={ctx.has("documents:edit", firm.firmId) ? <Button asChild variant="primary"><Link href={`${base}/new`}>New document</Link></Button> : null}
      />
      <DocumentTabs slug={firm.slug} current="documents" show={{ templates: ctx.has("document_templates:manage", firm.firmId), email: ctx.has("email:view", firm.firmId) || ctx.has("templates:manage", firm.firmId) }} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 text-[13px]" aria-label="Filter documents">
          {FILTERS.map((f) => <Link key={f.key} href={href({ status: f.key })} aria-current={status === f.key ? "page" : undefined} className={cn("rounded-md px-2.5 py-1", status === f.key ? "bg-sky font-medium text-ink" : "text-muted hover:text-ink")}>{f.label}</Link>)}
        </nav>
        <form className="flex flex-wrap gap-2" role="search">
          {status !== "open" ? <input type="hidden" name="status" value={status} /> : null}
          <Select name="kind" defaultValue={kind} aria-label="Type" className="w-48">
            <option value="">All types</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input name="q" defaultValue={q} placeholder="Title or reference" aria-label="Search documents" className="w-56" />
          <Button type="submit">Search</Button>
        </form>
      </div>
      <Panel>
        {rows.length === 0 ? (
          <EmptyState title="No documents here">Start one from a template with <strong>New document</strong>, or from a matter.</EmptyState>
        ) : (
          <div className={t.wrap}>
            <table className={t.table}>
              <thead><tr><th className={t.th}>Document</th><th className={t.th}>Type</th><th className={t.th}>Client / matter</th><th className={t.th}>Status</th><th className={t.th}>Author</th><th className={t.th}>Updated</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const st = DOC_STATUS[r.status];
                  return (
                    <tr key={r.id} className={t.row}>
                      <td className={t.td}>
                        <Link href={`${base}/${r.id}`} className="text-ink underline-offset-2 hover:underline">{r.title}</Link>
                        <div className="num text-xs text-muted">{r.ref}{r.version ? ` · v${r.version}` : ""}{r.aiAssisted ? <span className="ml-1.5 inline-flex items-center gap-0.5"><Sparkles className="size-3" aria-hidden />AI-assisted</span> : null}</div>
                      </td>
                      <td className={`${t.td} text-ink-2`}>{KIND_LABEL[r.kind]}</td>
                      <td className={`${t.td} num text-ink-2`}>{[r.clientRef, r.matterRef].filter(Boolean).join(" · ") || "Practice"}</td>
                      <td className={t.td}><Badge tone={st.tone}>{st.label}</Badge>{r.status === "in_review" && r.reviewerId === ctx.user.id ? <span className="ml-1.5 text-xs text-accent">for you</span> : null}</td>
                      <td className={`${t.td} text-ink-2`}>{r.author ?? "—"}</td>
                      <td className={`${t.td} text-muted`}><LocalTime value={r.updatedAt} mode="relative" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {total > pageSize ? (
        <nav className="mt-3 flex items-center justify-between text-[13px] text-muted" aria-label="Pages">
          <span>{total} documents</span>
          <span className="flex gap-2">
            {page > 1 ? <Link href={href({ page: page - 1 })} className="underline">Previous</Link> : null}
            {page * pageSize < total ? <Link href={href({ page: page + 1 })} className="underline">Next</Link> : null}
          </span>
        </nav>
      ) : null}
    </>
  );
}
