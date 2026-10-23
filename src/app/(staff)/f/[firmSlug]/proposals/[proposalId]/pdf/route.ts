import { NotFoundError } from "@/server/errors";
import { renderProposalPdf, pdfFileName } from "@/server/modules/proposals/pdf";
import { getProposalSnapshot, previewSnapshot } from "@/server/modules/proposals/proposals";
import { requireFirm } from "@/server/next/session";

export const runtime = "nodejs";

/** Staff PDF: the released version (what the client saw) or, for drafts, a marked preview. */
export async function GET(request: Request, { params }: RouteContext<"/f/[firmSlug]/proposals/[proposalId]/pdf">) {
  const { firmSlug, proposalId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("proposals:view", firm.firmId)) return new Response("Not found", { status: 404 });
  const v = Number(new URL(request.url).searchParams.get("version"));
  try {
    const released = Number.isInteger(v) && v > 0 ? await getProposalSnapshot(ctx, firm.firmId, proposalId, v) : null;
    const snapshot = released ?? (await previewSnapshot(ctx, firm.firmId, proposalId));
    const pdf = await renderProposalPdf(snapshot, !released);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdfFileName(snapshot)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
