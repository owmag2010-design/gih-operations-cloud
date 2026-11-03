"use server";

import { revalidatePath } from "next/cache";
import { endPortalSession, postClientMessage, requestSignInCode, tokenShape, verifySignInCode } from "@/server/modules/portal/client";
import { clearPortalSession, readPortalSession, setPortalSession } from "./session";

export type PortalFormState = { ok: boolean; message: string; step?: "code" } | null;

const CODE_MESSAGES: Record<string, string> = {
  sent: "We've emailed you a six-digit code. It expires in 15 minutes.",
  too_many: "You've asked for several codes in the last hour. Please wait a little, then try again.",
  not_found: "This link isn't active any more. Please ask your team for a new one.",
  email_failed: "We couldn't send the code just now. Please try again in a minute.",
};

export async function requestCodeAction(token: string): Promise<PortalFormState> {
  if (!tokenShape.test(token)) return { ok: false, message: CODE_MESSAGES.not_found };
  const r = await requestSignInCode(token);
  return { ok: r === "sent", message: CODE_MESSAGES[r], step: r === "sent" ? "code" : undefined };
}

const VERIFY_MESSAGES: Record<string, string> = {
  wrong: "That code doesn't match. Check the latest email and try again.",
  expired: "That code has expired or was already used. Ask for a new one.",
  locked: "Too many wrong tries. Ask for a new code.",
  not_found: "This link isn't active any more. Please ask your team for a new one.",
};

export async function verifyCodeAction(token: string, _: PortalFormState, form: FormData): Promise<PortalFormState> {
  const r = await verifySignInCode(token, String(form.get("code") ?? ""));
  if (r.result === "ok" && r.session) {
    await setPortalSession(token, r.session);
    revalidatePath(`/portal/${token}`);
    return { ok: true, message: "Signed in." };
  }
  return { ok: false, message: VERIFY_MESSAGES[r.result], step: "code" };
}

export async function sendMessageAction(token: string, _: PortalFormState, form: FormData): Promise<PortalFormState> {
  const session = await readPortalSession(token);
  if (!session) return { ok: false, message: "Your session has ended. Please sign in again." };
  const body = String(form.get("body") ?? "");
  if (!body.trim()) return { ok: false, message: "Write a message first." };
  const r = await postClientMessage(session, body);
  revalidatePath(`/portal/${token}`);
  return r === "ok"
    ? { ok: true, message: "Message sent. Your team will reply here, usually within one working day." }
    : { ok: false, message: r === "too_many" ? "You've sent several messages in a row. Please wait a few minutes." : r === "invalid" ? "Messages can be up to 4,000 characters." : "Your session has ended. Please sign in again." };
}

export async function signOutAction(token: string) {
  const session = await readPortalSession(token);
  if (session) await endPortalSession(session);
  await clearPortalSession(token);
  revalidatePath(`/portal/${token}`);
}
