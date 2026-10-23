"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import type { EmailBlock } from "@/server/db/schema";
import { toActionError, type ActionResult } from "@/server/errors";
import {
  createLeadFromThread,
  previewForRecord,
  previewTemplate,
  replyToThread,
  saveMailbox,
  saveTemplate,
  sendToRecord,
  setThreadStatus,
  type EmailScope,
} from "@/server/modules/email/mail";
import { requireStaff } from "@/server/next/session";

/** "hub" or a firm slug → the caller's context and the email scope. */
async function resolve(scopeKey: string) {
  const { ctx } = await requireStaff();
  if (scopeKey === "hub") return { ctx, where: { kind: "hub" } as EmailScope, base: "/hq" };
  const firm = ctx.firmBySlug(scopeKey);
  if (!firm) notFound();
  return { ctx, where: { kind: "firm", firmId: firm.firmId } as EmailScope, base: `/f/${firm.slug}` };
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const SENT: Record<string, string> = {
  sent: "Email sent.",
  not_configured: "Saved, but not sent: email sending isn't connected yet (no Resend key on the server).",
  failed: "Saved, but sending failed. Check the conversation for the reason.",
};

export async function sendToRecordAction(slug: string, target: { leadId?: string; clientId?: string }, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, where, base } = await resolve(slug);
  if (where.kind !== "firm") notFound();
  try {
    const r = await sendToRecord(ctx, where.firmId, target, { templateId: str(form, "templateId"), subject: str(form, "subject"), body: str(form, "body"), cc: str(form, "cc") });
    revalidatePath(base, "layout");
    return r.status === "sent" ? { ok: true, message: SENT.sent } : { ok: false, error: SENT[r.status] };
  } catch (err) {
    return toActionError(err);
  }
}

export async function previewComposeAction(slug: string, target: { leadId?: string; clientId?: string }, input: { templateId?: string; subject?: string; body?: string }): Promise<ActionResult<{ html: string; subject: string; to: string; from: string }>> {
  const { ctx, where } = await resolve(slug);
  if (where.kind !== "firm") notFound();
  try {
    return { ok: true, data: await previewForRecord(ctx, where.firmId, target, input) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function replyAction(scopeKey: string, threadId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, where, base } = await resolve(scopeKey);
  try {
    const r = await replyToThread(ctx, where, threadId, { templateId: str(form, "templateId"), body: str(form, "body"), cc: str(form, "cc") });
    revalidatePath(`${base}/inbox`, "layout");
    return r.status === "sent" ? { ok: true, message: "Reply sent." } : { ok: false, error: SENT[r.status] };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setThreadStatusAction(scopeKey: string, threadId: string, status: "open" | "closed"): Promise<ActionResult> {
  const { ctx, where, base } = await resolve(scopeKey);
  try {
    await setThreadStatus(ctx, where, threadId, status);
    revalidatePath(`${base}/inbox`, "layout");
    return { ok: true, message: status === "closed" ? "Conversation closed." : "Conversation reopened." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function createLeadFromThreadAction(slug: string, threadId: string): Promise<ActionResult> {
  const { ctx, where, base } = await resolve(slug);
  if (where.kind !== "firm") notFound();
  let id: string;
  try {
    id = (await createLeadFromThread(ctx, where.firmId, threadId)).id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(base, "layout");
  redirect(`${base}/leads/${id}?created=1`);
}

export type TemplatePayload = { name: string; category: string; subject: string; preheader: string; blocks: EmailBlock[]; isActive: boolean };

export async function saveTemplateAction(scopeKey: string, id: string | null, payload: TemplatePayload): Promise<ActionResult<{ id: string }>> {
  const { ctx, where, base } = await resolve(scopeKey);
  try {
    const t = await saveTemplate(ctx, where, id, payload);
    revalidatePath(`${base}/templates`, "layout");
    return { ok: true, data: { id: t.id }, message: id ? "Template saved." : "Template created." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function previewTemplateAction(scopeKey: string, payload: Omit<TemplatePayload, "name" | "category" | "isActive">): Promise<ActionResult<{ html: string; subject: string }>> {
  const { ctx, where } = await resolve(scopeKey);
  try {
    const r = await previewTemplate(ctx, where, payload);
    return { ok: true, data: { html: r.html, subject: r.subject } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveMailboxAction(id: string | null, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await saveMailbox(ctx, id, Object.fromEntries([...form.keys()].map((k) => [k, String(form.get(k))])));
    revalidatePath("/hq/email");
    return { ok: true, message: "Mailbox saved." };
  } catch (err) {
    return toActionError(err);
  }
}
