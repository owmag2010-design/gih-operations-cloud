import { NotFoundError } from "@/server/errors";
import { attachmentUrl } from "@/server/modules/mirror/mirror";
import { requireStaff } from "@/server/next/session";

export const runtime = "nodejs";

/** Open a mirrored attachment: fetch a fresh short-lived link from Airtable and redirect to it. */
export async function GET(request: Request) {
  const { ctx } = await requireStaff();
  const u = new URL(request.url);
  const [source, record, field, id] = ["source", "record", "field", "id"].map((k) => u.searchParams.get(k) ?? "");
  if (!/^rec[A-Za-z0-9]{14}$/.test(record) || !/^fld[A-Za-z0-9]{14}$/.test(field) || !/^att[A-Za-z0-9]{14}$/.test(id)) return new Response("Not found", { status: 404 });
  try {
    const url = await attachmentUrl(ctx, source, record, field, id);
    if (!/^https:\/\/[a-z0-9.-]*airtable(usercontent)?\.com\//i.test(url)) return new Response("Not found", { status: 404 });
    return Response.redirect(url, 302);
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    return new Response("Airtable couldn't provide the file right now. Try again shortly.", { status: 502 });
  }
}
