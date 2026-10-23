import { toActionError } from "@/server/errors";
import { MAX_UPLOAD_BYTES, uploadAttachment } from "@/server/modules/email/files";
import { requireStaff } from "@/server/next/session";

export const runtime = "nodejs";

/** Upload one attachment for an email being composed. */
export async function POST(request: Request) {
  const { ctx } = await requireStaff();
  if (Number(request.headers.get("content-length") ?? "0") > MAX_UPLOAD_BYTES + 64 * 1024) {
    return Response.json({ ok: false, error: `Files can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB each.` }, { status: 413 });
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    const practice = String(form.get("practice") ?? "");
    if (!(file instanceof File)) return Response.json({ ok: false, error: "Choose a file." }, { status: 400 });
    const row = await uploadAttachment(ctx, practice && practice !== "hub" ? practice : null, { name: file.name, type: file.type, data: Buffer.from(await file.arrayBuffer()) });
    return Response.json({ ok: true, file: row });
  } catch (err) {
    const e = toActionError(err);
    return Response.json(e, { status: 400 });
  }
}
