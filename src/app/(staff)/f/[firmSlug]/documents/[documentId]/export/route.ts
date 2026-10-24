import { NotFoundError } from "@/server/errors";
import { exportSource } from "@/server/modules/documents/documents";
import { exportFileName, renderDocumentDocx, renderDocumentPdf } from "@/server/modules/documents/render";
import { requireFirm } from "@/server/next/session";

export const runtime = "nodejs";

/**
 * PDF or Word export. A final document's PDF is the one stored when it was
 * made final, byte for byte. Anything else is marked as a draft.
 */
export async function GET(request: Request, { params }: RouteContext<"/f/[firmSlug]/documents/[documentId]/export">) {
  const { firmSlug, documentId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("documents:view", firm.firmId)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "docx" ? "docx" : "pdf";
  const v = Number(url.searchParams.get("version"));
  try {
    const { input, storedPdf } = await exportSource(ctx, firm.firmId, documentId, Number.isInteger(v) && v > 0 ? v : undefined);
    const body = format === "pdf" ? (storedPdf ?? (await renderDocumentPdf(input))) : await renderDocumentDocx(input);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `${format === "pdf" ? "inline" : "attachment"}; filename="${exportFileName(input, format)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
