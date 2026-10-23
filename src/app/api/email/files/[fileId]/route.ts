import { NotFoundError } from "@/server/errors";
import { readFile } from "@/server/modules/email/files";
import { requireStaff } from "@/server/next/session";
import { fileResponse } from "@/server/next/file-response";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: RouteContext<"/api/email/files/[fileId]">) {
  const { ctx } = await requireStaff();
  const { fileId } = await params;
  try {
    return fileResponse(await readFile(ctx, fileId), new URL(request.url).searchParams.has("view"));
  } catch (err) {
    if (err instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw err;
  }
}
