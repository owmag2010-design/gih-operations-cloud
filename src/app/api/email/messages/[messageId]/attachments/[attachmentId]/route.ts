import { NotFoundError, ValidationError } from "@/server/errors";
import { messageAttachment } from "@/server/modules/email/sync";
import { requireStaff } from "@/server/next/session";
import { fileResponse } from "@/server/next/file-response";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Download an attachment of a received or synced message (fetched from the provider once, then kept). */
export async function GET(request: Request, { params }: RouteContext<"/api/email/messages/[messageId]/attachments/[attachmentId]">) {
  const { ctx } = await requireStaff();
  const { messageId, attachmentId } = await params;
  try {
    return fileResponse(await messageAttachment(ctx, messageId, decodeURIComponent(attachmentId)), new URL(request.url).searchParams.has("view"));
  } catch (err) {
    if (err instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (err instanceof ValidationError) return new Response(err.message, { status: 422 });
    throw err;
  }
}
