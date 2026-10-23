"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/server/errors";
import { visibleMailboxes } from "@/server/modules/email/access";
import {
  addNote,
  assignConversation,
  createIntakeFromThread,
  createLeadFromThread,
  deleteDraft,
  getDraft,
  inboxAssignees,
  linkConversation,
  listTemplates,
  markUnread,
  previewMessage,
  saveDraft,
  searchLinkTargets,
  sendMessage,
  setConversationStatus,
  type ComposeInput,
} from "@/server/modules/email/mail";
import { previewSignature, saveSignature, type SignatureInput } from "@/server/modules/email/signatures";
import { disconnectMailbox, syncMailboxNow } from "@/server/modules/email/sync";
import { requireStaff } from "@/server/next/session";

export type MailboxOption = { id: string; label: string; firmId: string | null; firmName: string; fromName: string; fromAddress: string; provider: string; kind: string; status: string | null };
export type TemplateChoice = { id: string; name: string; category: string; subject: string; firmId: string | null; format: "blocks" | "html"; slots: { key: string; label: string; default: string; multiline: boolean }[] };

/** Mailboxes the user can send from and the templates usable with each. */
export async function composeOptionsAction(): Promise<ActionResult<{ mailboxes: MailboxOption[]; templates: TemplateChoice[] }>> {
  const { ctx } = await requireStaff();
  try {
    const boxes = await visibleMailboxes(ctx, { sendable: true });
    const practices = [...new Set(boxes.map((b) => b.firmId))];
    const seen = new Map<string, TemplateChoice>();
    for (const p of practices) {
      const rows = await listTemplates(ctx, p ? { kind: "firm", firmId: p } : { kind: "hub" }, { includeHub: true, activeOnly: true }).catch(() => []);
      for (const t of rows) seen.set(t.id, { id: t.id, name: t.name, category: t.category, subject: t.subject, firmId: t.firmId, format: t.format, slots: t.slots });
    }
    return {
      ok: true,
      data: {
        mailboxes: boxes.map((b) => ({ id: b.id, label: b.label, firmId: b.firmId, firmName: b.firmName ?? "Global Immigration Hub", fromName: b.fromName, fromAddress: b.accountEmail ?? b.fromAddress, provider: b.provider, kind: b.kind, status: b.connectionStatus })),
        templates: [...seen.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
      },
    };
  } catch (err) {
    return toActionError(err);
  }
}

export type PreviewData = { subject: string; html: string; text: string; to: string[]; cc: string[]; bcc: string[]; from: string; via: string; missingFields: string[]; emptySlots: string[] };

export async function previewMessageAction(input: ComposeInput): Promise<ActionResult<PreviewData>> {
  const { ctx } = await requireStaff();
  try {
    const r = await previewMessage(ctx, input);
    return { ok: true, data: { subject: r.subject, html: r.html, text: r.text, to: r.to, cc: r.cc, bcc: r.bcc, from: r.from, via: r.via, missingFields: r.missingFields, emptySlots: r.emptySlots } };
  } catch (err) {
    return toActionError(err);
  }
}

const SENT_LABEL: Record<string, string> = {
  sent: "Accepted by the mail provider. Delivery shows on the message when the provider reports it.",
  not_configured: "Saved but not sent: sending isn't connected on the server yet.",
};

export async function sendMessageAction(input: ComposeInput): Promise<ActionResult<{ threadId: string }>> {
  const { ctx } = await requireStaff();
  try {
    const r = await sendMessage(ctx, input);
    revalidatePath("/inbox");
    if (r.status === "failed") return { ok: false, error: `Not sent: ${r.error ?? "the provider refused it"}. It's saved in the conversation as failed.` };
    if (r.status === "not_configured") return { ok: false, error: SENT_LABEL.not_configured };
    return { ok: true, data: { threadId: r.threadId }, message: SENT_LABEL.sent };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveDraftAction(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const { ctx } = await requireStaff();
  try {
    const d = await saveDraft(ctx, input);
    return { ok: true, data: { id: d.id } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function loadDraftAction(id: string) {
  const { ctx } = await requireStaff();
  try {
    return { ok: true as const, data: await getDraft(ctx, id) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteDraftAction(id: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await deleteDraft(ctx, id);
    revalidatePath("/inbox");
    return { ok: true, message: "Draft deleted." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function addNoteAction(threadId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await addNote(ctx, threadId, String(form.get("body") ?? ""));
    revalidatePath("/inbox");
    return { ok: true, message: "Note added. Only your team can see it." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function assignAction(threadId: string, userId: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await assignConversation(ctx, threadId, userId || null);
    revalidatePath("/inbox");
    return { ok: true, message: userId ? "Assigned." : "Unassigned." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function assigneesAction(firmId: string | null) {
  const { ctx } = await requireStaff();
  try {
    return { ok: true as const, data: await inboxAssignees(ctx, firmId) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function conversationStatusAction(threadId: string, status: "open" | "closed"): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await setConversationStatus(ctx, threadId, status);
    revalidatePath("/inbox");
    return { ok: true, message: status === "closed" ? "Conversation closed." : "Conversation reopened." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function markUnreadAction(threadId: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await markUnread(ctx, threadId);
    revalidatePath("/inbox");
    return { ok: true, message: "Marked as unread." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function searchLinkTargetsAction(firmId: string, q: string) {
  const { ctx } = await requireStaff();
  try {
    return { ok: true as const, data: await searchLinkTargets(ctx, firmId, q) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function linkAction(threadId: string, target: { leadId?: string | null; clientId?: string | null }): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await linkConversation(ctx, threadId, target);
    revalidatePath("/inbox");
    return { ok: true, message: target.leadId || target.clientId ? "Linked." : "Unlinked." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function createEnquiryFromThreadAction(threadId: string, firmId: string | null): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  let href: string;
  try {
    if (firmId) {
      const lead = await createLeadFromThread(ctx, firmId, threadId);
      href = `/f/${ctx.firm(firmId).slug}/leads/${lead.id}?created=1`;
    } else {
      const item = await createIntakeFromThread(ctx, threadId);
      href = `/hq/intake/${item.id}`;
    }
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/inbox");
  redirect(href);
}

export async function syncNowAction(mailboxId: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    const r = await syncMailboxNow(ctx, mailboxId);
    revalidatePath("/inbox");
    revalidatePath("/settings/email");
    if (r.error) return { ok: false, error: `Sync problem: ${r.error}` };
    return { ok: true, message: r.imported ? `${r.imported} new message${r.imported === 1 ? "" : "s"}.` : r.importDone ? "Up to date." : "Importing history. It continues in the background." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function disconnectAction(mailboxId: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await disconnectMailbox(ctx, mailboxId);
    revalidatePath("/settings/email");
    return { ok: true, message: "Disconnected. Conversations already imported stay in the inbox." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveSignatureAction(practice: string, which: "practice" | "mine", input: SignatureInput): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await saveSignature(ctx, practice === "hub" ? null : practice, which, input);
    revalidatePath("/settings/signatures");
    return { ok: true, message: "Signature saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function previewSignatureAction(practice: string, input: SignatureInput): Promise<ActionResult<{ html: string }>> {
  const { ctx } = await requireStaff();
  try {
    const r = await previewSignature(ctx, practice === "hub" ? null : practice, input);
    return { ok: true, data: { html: r.html } };
  } catch (err) {
    return toActionError(err);
  }
}
