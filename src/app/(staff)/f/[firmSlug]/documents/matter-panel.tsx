import Link from "next/link";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, Panel, PanelHeader } from "@/components/ui/primitives";
import type { AccessContext } from "@/server/access/context";
import { KIND_LABEL, listDocuments, listFiles } from "@/server/modules/documents/documents";
import { FileUpload, OcrTextDialog, RerunOcrButton } from "./client";
import { DOC_STATUS, OCR_LABEL } from "./labels";

/** Documents and uploaded files on a matter (or a client without a matter). */
export async function DocumentsPanel({ ctx, firmId, slug, link }: { ctx: AccessContext; firmId: string; slug: string; link: { matterId?: string; clientId?: string } }) {
  if (!ctx.has("documents:view", firmId)) return null;
  const [docs, files] = await Promise.all([listDocuments(ctx, firmId, { ...link, status: undefined }), listFiles(ctx, firmId, link)]);
  const canEdit = ctx.has("documents:edit", firmId);
  const q = link.matterId ? `matter=${link.matterId}` : `client=${link.clientId}`;
  return (
    <Panel id="documents">
      <PanelHeader title="Documents and files" actions={canEdit ? <Button asChild size="sm"><Link href={`/f/${slug}/documents/new?${q}`}>New document</Link></Button> : null} />
      {docs.rows.length ? (
        <ul className="divide-y divide-hairline text-[13px]">
          {docs.rows.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <Link href={`/f/${slug}/documents/${d.id}`} className="text-ink underline-offset-2 hover:underline">{d.title}</Link>
                <span className="num ml-2 text-xs text-muted">{d.ref} · {KIND_LABEL[d.kind]}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2"><Badge tone={DOC_STATUS[d.status].tone}>{DOC_STATUS[d.status].label}</Badge><span className="text-xs text-muted"><LocalTime value={d.updatedAt} mode="relative" /></span></span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-2 text-[13px] text-muted">No documents yet.</p>
      )}
      <div className="border-t border-hairline px-4 py-3">
        <h3 className="mb-2 text-[13px] font-semibold text-ink">Uploaded files</h3>
        {files.length ? (
          <ul className="mb-3 flex flex-col gap-1.5 text-[13px]">
            {files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <a href={`/f/${slug}/documents/files/${f.id}`} className="underline-offset-2 hover:underline">{f.filename}</a>
                  <span className="ml-2 text-xs text-muted">{Math.max(1, Math.round(f.size / 1024))} KB · {f.uploadedBy ?? "—"} · <LocalTime value={f.createdAt} mode="relative" /></span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {OCR_LABEL[f.ocrStatus]}
                  {f.ocrStatus === "done" ? <OcrTextDialog filename={f.filename} text={f.ocrText ?? ""} engine={f.ocrEngine} confidence={f.ocrConfidence} /> : null}
                  {canEdit && f.ocrStatus === "failed" ? <RerunOcrButton slug={slug} fileId={f.id} /> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {canEdit ? <FileUpload slug={slug} link={link} /> : files.length ? null : <p className="text-xs text-muted">None.</p>}
      </div>
    </Panel>
  );
}
