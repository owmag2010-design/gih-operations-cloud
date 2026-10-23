import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { beginConnect } from "@/server/modules/email/sync";
import { requireStaff } from "@/server/next/session";

export const runtime = "nodejs";
const NONCE_COOKIE = "gih_mail_oauth";

/** Start connecting a Microsoft 365 or Gmail mailbox: sign the state, set the nonce cookie, go to the provider. */
export async function GET(request: Request, { params }: RouteContext<"/api/mail/oauth/[provider]/start">) {
  const { ctx } = await requireStaff();
  const { provider } = await params;
  const url = new URL(request.url);
  const back = new URL("/settings/email", env().APP_URL);
  try {
    const { url: target, nonce } = await beginConnect(ctx, { provider, mailboxId: url.searchParams.get("mailbox") || null, practice: url.searchParams.get("practice") || null });
    (await cookies()).set(NONCE_COOKIE, nonce, { httpOnly: true, secure: env().NODE_ENV === "production", sameSite: "lax", path: "/api/mail/oauth", maxAge: 600 });
    return NextResponse.redirect(target);
  } catch (err) {
    back.searchParams.set("error", err instanceof Error ? err.message.slice(0, 200) : "Couldn't start the connection.");
    return NextResponse.redirect(back);
  }
}
