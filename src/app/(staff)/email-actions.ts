"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import type { EmailBlock, TemplateSlot } from "@/server/db/schema";
import { toActionError, type ActionResult } from "@/server/errors";
import { previewTemplate, saveMailbox, saveTemplate, type EmailScope } from "@/server/modules/email/mail";
import { requireStaff } from "@/server/next/session";

/** "hub" or a firm slug → the caller's context and the email scope. */
async function resolve(scopeKey: string) {
  const { ctx } = await requireStaff();
  if (scopeKey === "hub") return { ctx, where: { kind: "hub" } as EmailScope, base: "/hq" };
  const firm = ctx.firmBySlug(scopeKey);
  if (!firm) notFound();
  return { ctx, where: { kind: "firm", firmId: firm.firmId } as EmailScope, base: `/f/${firm.slug}` };
}

export type TemplatePayload = {
  name: string;
  category: string;
  subject: string;
  preheader: string;
  blocks: EmailBlock[];
  isActive: boolean;
  format?: "blocks" | "html";
  html?: string | null;
  slots?: TemplateSlot[];
  textOverride?: string | null;
};

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

export async function previewTemplateAction(scopeKey: string, payload: Omit<TemplatePayload, "name" | "category" | "isActive">): Promise<ActionResult<{ html: string; subject: string; text: string }>> {
  const { ctx, where } = await resolve(scopeKey);
  try {
    const r = await previewTemplate(ctx, where, payload);
    return { ok: true, data: { html: r.html, subject: r.subject, text: r.text } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveMailboxAction(id: string | null, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await saveMailbox(ctx, id, Object.fromEntries([...form.keys()].map((k) => [k, String(form.get(k))])));
    revalidatePath("/settings/email");
    return { ok: true, message: "Mailbox saved." };
  } catch (err) {
    return toActionError(err);
  }
}
