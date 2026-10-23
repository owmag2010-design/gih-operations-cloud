import { renderProposalPdf, pdfFileName } from "@/server/modules/proposals/pdf";
import { getPublicProposal } from "@/server/modules/proposals/proposals";

export const runtime = "nodejs";

/** Client PDF of the released proposal. Same token rules as the proposal page. */
export async function GET(_: Request, { params }: RouteContext<"/p/[token]/pdf">) {
  const { token } = await params;
  const p = await getPublicProposal(token);
  if (!p || p.expired) return new Response("This link is invalid or has expired.", { status: 404, headers: { "Cache-Control": "no-store" } });
  const pdf = await renderProposalPdf(p.snapshot);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(p.snapshot)}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
