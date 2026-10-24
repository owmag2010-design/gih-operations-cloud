import { revalidatePath } from "next/cache";
import { toActionError } from "@/server/errors";
import { MAX_UPLOAD_BYTES, uploadFile } from "@/server/modules/documents/documents";
import { requireFirm } from "@/server/next/session";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Upload a file to a client, matter or document. Its text is read straight away (OCR for images). */
export async function POST(request: Request, { params }: RouteContext<"/f/[firmSlug]/documents/files">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (Number(request.headers.get("content-length") ?? "0") > MAX_UPLOAD_BYTES + 64 * 1024) {
    return Response.json({ ok: false, error: "Files can be up to 4 MB." }, { status: 413 });
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ ok: false, error: "Choose a file." }, { status: 400 });
    const meta = { clientId: String(form.get("clientId") ?? ""), matterId: String(form.get("matterId") ?? ""), documentId: String(form.get("documentId") ?? ""), description: String(form.get("description") ?? "") };
    const row = await uploadFile(ctx, firm.firmId, meta, { name: file.name, type: file.type, data: Buffer.from(await file.arrayBuffer()) });
    revalidatePath(`/f/${firm.slug}/matters`, "layout");
    revalidatePath(`/f/${firm.slug}/documents`, "layout");
    return Response.json({ ok: true, id: row.id });
  } catch (err) {
    return Response.json(toActionError(err), { status: 400 });
  }
}
