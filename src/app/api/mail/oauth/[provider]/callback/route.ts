import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { completeConnect, syncConnection } from "@/server/modules/email/sync";
import { requireStaff } from "@/server/next/session";

export const runtime = "nodejs";
export const maxDuration = 60;

/** The provider sends the person back here after they approve access. */
export async function GET(request: Request) {
  const { ctx } = await requireStaff();
  const url = new URL(request.url);
  const back = new URL("/settings/email", env().APP_URL);
  const jar = await cookies();
  const nonce = jar.get("gih_mail_oauth")?.value;
  jar.delete({ name: "gih_mail_oauth", path: "/api/mail/oauth" });
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) {
    back.searchParams.set("error", `The provider didn't connect the mailbox: ${providerError.slice(0, 160)}`);
    return NextResponse.redirect(back);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    back.searchParams.set("error", "The provider's reply was incomplete. Try connecting again.");
    return NextResponse.redirect(back);
  }
  try {
    const { connectionId, mailbox } = await completeConnect(ctx, state, code, nonce);
    // Start the history import straight away; the scheduled sync continues it.
    await syncConnection(ctx.orgId, connectionId, Date.now() + 40_000).catch(() => null);
    back.searchParams.set("connected", mailbox.fromAddress);
  } catch (err) {
    back.searchParams.set("error", err instanceof Error ? err.message.slice(0, 200) : "Couldn't connect the mailbox.");
  }
  return NextResponse.redirect(back);
}
