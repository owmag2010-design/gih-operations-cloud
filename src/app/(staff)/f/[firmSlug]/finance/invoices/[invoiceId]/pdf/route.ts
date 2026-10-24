import { NotFoundError } from "@/server/errors";
import { canViewFinance, getInvoice } from "@/server/modules/finance/finance";
import { invoiceFileName, renderInvoicePdf } from "@/server/modules/finance/pdf";
import { requireFirm } from "@/server/next/session";

export const runtime = "nodejs";

/** The invoice as a branded A4 PDF. Drafts are marked DRAFT and carry no number. */
export async function GET(_: Request, { params }: RouteContext<"/f/[firmSlug]/finance/invoices/[invoiceId]/pdf">) {
  const { firmSlug, invoiceId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!canViewFinance(ctx, firm.firmId)) return new Response("Not found", { status: 404 });
  try {
    const d = await getInvoice(ctx, firm.firmId, invoiceId);
    const input = { printed: d.printed, invoice: d.invoice, lines: d.lines, clientRef: d.client?.ref ?? null, matterRef: d.matter?.ref ?? null };
    const pdf = await renderInvoicePdf(input);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${invoiceFileName(input)}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
