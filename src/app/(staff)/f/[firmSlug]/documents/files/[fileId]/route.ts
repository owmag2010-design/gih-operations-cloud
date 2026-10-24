import { NotFoundError } from "@/server/errors";
import { getFile } from "@/server/modules/documents/documents";
import { requireFirm } from "@/server/next/session";

export const runtime = "nodejs";

/** The uploaded original, unchanged. Downloaded rather than displayed, so uploaded HTML or SVG can't run in the app. */
export async function GET(_: Request, { params }: RouteContext<"/f/[firmSlug]/documents/files/[fileId]">) {
  const { firmSlug, fileId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("documents:view", firm.firmId)) return new Response("Not found", { status: 404 });
  try {
    const f = await getFile(ctx, firm.firmId, fileId);
    const safe = f.filename.replace(/["\r\n]/g, "_");
    return new Response(new Uint8Array(f.data), {
      headers: {
        "Content-Type": f.contentType === "application/pdf" || f.contentType.startsWith("image/") && !f.contentType.includes("svg") ? f.contentType : "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
