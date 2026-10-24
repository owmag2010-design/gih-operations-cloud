import type { Metadata } from "next";
import { Download, FileText, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, Notice, Panel, PanelHeader } from "@/components/ui/primitives";
import { NotFoundError } from "@/server/errors";
import { MERGE_FIELDS } from "@/server/modules/documents/content";
import { getDocument, KIND_LABEL } from "@/server/modules/documents/documents";
import { requireFirm } from "@/server/next/session";
import {
  AiDraftDialog, CommentForm, DetailsDialog, DocumentWorkspace, DuplicateButton, FileUpload, FinaliseButton, ReopenButton, ResolveCommentButton, RestoreVersionButton, ReviewActions, SaveVersionDialog,
  SubmitDialog,
} from "../client";
import { DOC_STATUS, OCR_LABEL } from "../labels";

export const metadata: Metadata = { title: "Document" };

const COMMENT_LABEL = { comment: null, changes_requested: "Changes requested", approved: "Approved" } as const;

export default async function DocumentPage({ params, searchParams }: PageProps<"/f/[firmSlug]/documents/[documentId]">) {
  const { firmSlug, documentId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("documents:view", firm.firmId)) notFound();
  let v: Awaited<ReturnType<typeof getDocument>>;
  try {
    v = await getDocument(ctx, firm.firmId, documentId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const sp = await searchParams;
  const missing = typeof sp.missing === "string" ? sp.missing.split(",").filter(Boolean) : [];
  const { document: d, people, versions, comments, client, matter, files, gaps, reviewers } = v;
  const base = `/f/${firm.slug}`;
  const st = DOC_STATUS[d.status];
  const canEdit = ctx.has("documents:edit", firm.firmId);
  const canReview = ctx.has("documents:approve", firm.firmId);
  const wroteIt = d.contentUpdatedById === ctx.user.id && !ctx.has("firm:manage", firm.firmId);
  const draft = d.status === "draft" || d.status === "changes_requested";
  const gapCount = gaps.prompts.length + gaps.fields.length;
  const lastChangeRequest = [...comments].reverse().find((c) => c.kind === "changes_requested");
  const exportHref = (format: "pdf" | "docx", version?: number) => `${base}/documents/${d.id}/export?format=${format}${version ? `&version=${version}` : ""}`;
  const fields = Object.entries(MERGE_FIELDS) as [string, string][];
  const kinds = Object.entries(KIND_LABEL) as [string, string][];

  return (
    <>
      <p className="mb-2 text-[13px]"><Link href={`${base}/documents`} className="text-muted hover:text-ink">← Documents</Link></p>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <span className="num">{d.ref}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
        <span>{KIND_LABEL[d.kind]}</span>
        {d.aiAssisted ? <Badge tone="warn"><Sparkles className="size-3" aria-hidden /> AI-assisted draft</Badge> : null}
        {client ? <Link href={`${base}/clients/${client.id}`} className="underline-offset-2 hover:underline">{[client.firstName, client.lastName].filter(Boolean).join(" ")} <span className="num">({client.ref})</span></Link> : null}
        {matter ? <Link href={`${base}/matters/${matter.id}`} className="underline-offset-2 hover:underline"><span className="num">{matter.ref}</span> {matter.title}</Link> : null}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {draft && canEdit ? <><SaveVersionDialog slug={firm.slug} id={d.id} /><SubmitDialog slug={firm.slug} id={d.id} reviewers={reviewers} gaps={gapCount} /><AiDraftDialog slug={firm.slug} id={d.id} blocked={v.ai.blocked} /></> : null}
        {d.status === "in_review" && canReview && !wroteIt ? <ReviewActions slug={firm.slug} id={d.id} /> : null}
        {(d.status === "in_review" || d.status === "approved") && canEdit ? <ReopenButton slug={firm.slug} id={d.id} approved={d.status === "approved"} /> : null}
        {d.status === "approved" && canEdit ? <FinaliseButton slug={firm.slug} id={d.id} /> : null}
        {d.status === "final" && canEdit ? <DuplicateButton slug={firm.slug} id={d.id} /> : null}
        <span className="ml-auto flex flex-wrap gap-2">
          <Button asChild><a href={exportHref("pdf")} target="_blank" rel="noopener"><FileText className="size-4" /> PDF</a></Button>
          <Button asChild><a href={exportHref("docx")}><Download className="size-4" /> Word</a></Button>
          {d.status !== "final" && canEdit ? <DetailsDialog slug={firm.slug} id={d.id} kind={d.kind} letterhead={d.letterhead} kinds={kinds} /> : null}
        </span>
      </div>

      <div className="mb-4 flex flex-col gap-2">
        {missing.length ? <Notice tone="warn">Some merge fields had no value and are still shown as {"{{…}}"}: {missing.join(", ")}. Fill them in by hand or add the details to the client or matter.</Notice> : null}
        {d.status === "changes_requested" && lastChangeRequest ? <Notice tone="warn"><strong>{lastChangeRequest.author ?? "The reviewer"} asked for changes:</strong> {lastChangeRequest.body}</Notice> : null}
        {d.status === "in_review" ? <Notice>{people.reviewer ? `With ${people.reviewer} for review.` : "Waiting for a reviewer."} The text is locked while it is reviewed.{canReview && wroteIt ? " You wrote this version, so someone else reviews it." : ""}</Notice> : null}
        {d.status === "approved" ? <Notice tone="ok">Approved by {people.approvedBy ?? "a reviewer"}{d.approvedAt ? <> on <LocalTime value={d.approvedAt} mode="date" /></> : null}. Make it final to issue it; any further edit needs another review.</Notice> : null}
        {d.status === "final" ? <Notice>Final version {d.finalVersion}, made final by {people.finalisedBy ?? "—"}{d.finalisedAt ? <> on <LocalTime value={d.finalisedAt} mode="date" /></> : null}. The final PDF is kept exactly as issued and this document can&apos;t be changed.</Notice> : null}
        {d.aiAssisted && d.status !== "final" ? <Notice tone="warn">Parts of this draft were written with AI from the linked records. Check every statement and complete each [[GAP]] before sending it for review.</Notice> : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <DocumentWorkspace slug={firm.slug} id={d.id} title={d.title} content={d.content} updatedAt={d.contentUpdatedAt.toISOString()} editable={draft && canEdit} fields={fields} gaps={gapCount} />

        <aside className="flex flex-col gap-4">
          <Panel className="p-4">
            <h2 className="mb-2 text-[13px] font-semibold text-ink">Still to complete</h2>
            {gapCount === 0 ? (
              <p className="text-xs text-ok">Nothing outstanding.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-xs">
                {gaps.fields.map((f) => <li key={`f-${f}`} className="text-accent">{`{{${f}}}`} <span className="text-muted">merge field without a value</span></li>)}
                {gaps.prompts.slice(0, 12).map((p, i) => <li key={`p-${i}`} className="text-warn">[[{p}]]</li>)}
                {gaps.prompts.length > 12 ? <li className="text-muted">and {gaps.prompts.length - 12} more</li> : null}
              </ul>
            )}
            {draft ? <p className="mt-2 text-xs text-muted">Edits save automatically. Saved {people.lastEditedBy ? `by ${people.lastEditedBy} ` : ""}<LocalTime value={d.contentUpdatedAt} mode="relative" />.</p> : null}
          </Panel>

          <Panel>
            <PanelHeader title="Review and comments" />
            <ol className="flex flex-col gap-3 px-4 pb-3 text-[13px]">
              {comments.length === 0 ? <li className="text-muted">No comments yet.</li> : null}
              {comments.map((c) => (
                <li key={c.id} className={c.resolvedAt ? "opacity-60" : ""}>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span>{c.author ?? "Someone"}{c.version ? ` · v${c.version}` : ""} · <LocalTime value={c.createdAt} mode="relative" /></span>
                    {!c.resolvedAt && c.kind === "comment" && canEdit && d.status !== "final" ? <ResolveCommentButton slug={firm.slug} id={d.id} commentId={c.id} /> : c.resolvedAt ? <span>Resolved</span> : null}
                  </div>
                  {COMMENT_LABEL[c.kind] ? <Badge tone={c.kind === "approved" ? "ok" : "warn"} className="mt-1">{COMMENT_LABEL[c.kind]}</Badge> : null}
                  <p className="mt-0.5 whitespace-pre-wrap text-ink">{c.body}</p>
                </li>
              ))}
            </ol>
            {canEdit || canReview ? <div className="border-t border-hairline p-4"><CommentForm slug={firm.slug} id={d.id} /></div> : null}
          </Panel>

          <Panel>
            <PanelHeader title="Versions" description="Saved versions are never changed." />
            {versions.length === 0 ? (
              <p className="px-4 pb-4 text-xs text-muted">None saved yet. Versions are saved when you choose Save version, send for review, or make it final.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-hairline text-[13px]">
                {versions.map((ver) => (
                  <li key={ver.version} className="flex items-start justify-between gap-2 px-4 py-2">
                    <div>
                      <span className="font-medium">v{ver.version}</span>{ver.isFinal ? <Badge className="ml-1.5">Final</Badge> : null}
                      <div className="text-xs text-muted">{ver.note ? `${ver.note} · ` : ""}{ver.author ?? "—"} · <LocalTime value={ver.createdAt} mode="relative" /></div>
                    </div>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <a href={exportHref("pdf", ver.version)} target="_blank" rel="noopener" className="text-xs text-accent underline-offset-2 hover:underline">PDF</a>
                      {draft && canEdit && !ver.isFinal ? <RestoreVersionButton slug={firm.slug} id={d.id} version={ver.version} /> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel className="p-4">
            <h2 className="mb-2 text-[13px] font-semibold text-ink">Attached files</h2>
            {files.length ? (
              <ul className="mb-3 flex flex-col gap-1 text-[13px]">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2">
                    <a href={`${base}/documents/files/${f.id}`} className="truncate underline-offset-2 hover:underline">{f.filename}</a>
                    <span className="shrink-0 text-xs text-muted">{OCR_LABEL[f.ocrStatus]}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {canEdit && d.status !== "final" ? <FileUpload slug={firm.slug} link={{ documentId: d.id }} /> : files.length ? null : <p className="text-xs text-muted">None.</p>}
          </Panel>
        </aside>
      </div>
    </>
  );
}
