import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { MAX_UPLOAD, tokenShape, uploadClientFile } from "@/server/modules/portal/client";
import { portalCookieName } from "../session";

/**
 * Client uploads. A route handler rather than a server action, because actions
 * are capped at 1 MB. The session cookie is SameSite=Lax (never sent on a
 * cross-site POST) and the Origin is checked as well.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!tokenShape.test(token)) return NextResponse.json({ result: "signed_out" }, { status: 404 });
  const origin = req.headers.get("origin");
  const allowed = [env().APP_URL, env().PORTAL_URL].filter(Boolean).map((u) => new URL(u).origin);
  if (origin && !allowed.includes(origin) && origin !== req.nextUrl.origin) return NextResponse.json({ result: "forbidden" }, { status: 403 });

  const session = req.cookies.get(portalCookieName(token))?.value;
  if (!session) return NextResponse.json({ result: "signed_out" }, { status: 401 });

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_UPLOAD + 64 * 1024) return NextResponse.json({ result: "too_large" }, { status: 413 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ result: "invalid" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ result: "invalid" }, { status: 400 });
  const r = await uploadClientFile(session, {
    itemId: String(form.get("itemId") ?? "") || null,
    filename: file.name,
    contentType: file.type,
    data: Buffer.from(await file.arrayBuffer()),
  });
  const status = r.result === "ok" ? 200 : r.result === "signed_out" ? 401 : r.result === "too_many" ? 429 : 400;
  return NextResponse.json({ result: r.result }, { status });
}
