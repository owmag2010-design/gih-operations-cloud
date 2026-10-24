"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/server/errors";
import {
  addComment, approveDocument, autosaveDocument, createDocument, draftWithAi, duplicateDocument, finaliseDocument, reopenDocument, requestChanges, rerunOcr, resolveComment,
  restoreVersion, saveTemplate, saveVersion, setTemplateActive, submitForReview, updateDocumentDetails,
} from "@/server/modules/documents/documents";
import { requireFirm } from "@/server/next/session";

type Ctx = Awaited<ReturnType<typeof requireFirm>>["ctx"];
const data = (f: FormData) => Object.fromEntries([...f.keys()].map((k) => [k, String(f.get(k))]));

async function run(slug: string, fn: (firmId: string, ctx: Ctx) => Promise<unknown>, message: string): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await fn(firm.firmId, ctx);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/documents`, "layout");
  revalidatePath(`/f/${slug}/matters`, "layout");
  return { ok: true, message };
}

export async function createDocumentAction(slug: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  let id: string;
  let missing: string[];
  try {
    const r = await createDocument(ctx, firm.firmId, data(form));
    id = r.document.id;
    missing = r.missing;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/documents`, "layout");
  redirect(`/f/${slug}/documents/${id}${missing.length ? `?missing=${encodeURIComponent(missing.join(","))}` : ""}`);
}

export async function autosaveAction(slug: string, id: string, payload: { title?: string; content: unknown; baseUpdatedAt?: string }): Promise<ActionResult<{ savedAt: string; gaps: number }>> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    const r = await autosaveDocument(ctx, firm.firmId, id, payload);
    return { ok: true, data: { savedAt: r.savedAt, gaps: r.gaps.prompts.length + r.gaps.fields.length } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveVersionAction(slug: string, id: string, _: ActionResult | null, form: FormData) {
  return run(slug, async (f, ctx) => saveVersion(ctx, f, id, String(form.get("note") ?? "")), "Version saved.");
}
export async function restoreVersionAction(slug: string, id: string, version: number) {
  return run(slug, (f, ctx) => restoreVersion(ctx, f, id, version), `Restored version ${version} into the draft.`);
}
export async function detailsAction(slug: string, id: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => updateDocumentDetails(ctx, f, id, { kind: String(form.get("kind")), letterhead: form.get("letterhead") === "on" }), "Details saved.");
}
export async function submitAction(slug: string, id: string, _: ActionResult | null, form: FormData) {
  const reviewer = String(form.get("reviewerId") ?? "");
  return run(slug, (f, ctx) => submitForReview(ctx, f, id, reviewer || null, String(form.get("note") ?? "")), "Sent for review.");
}
export async function requestChangesAction(slug: string, id: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => requestChanges(ctx, f, id, String(form.get("body") ?? "")), "Changes requested.");
}
export async function approveAction(slug: string, id: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => approveDocument(ctx, f, id, String(form.get("note") ?? "")), "Approved.");
}
export async function reopenAction(slug: string, id: string) {
  return run(slug, (f, ctx) => reopenDocument(ctx, f, id), "Reopened for editing.");
}
export async function finaliseAction(slug: string, id: string) {
  return run(slug, (f, ctx) => finaliseDocument(ctx, f, id), "Made final. The final PDF is kept as issued.");
}
export async function duplicateAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  let newId: string;
  try {
    newId = (await duplicateDocument(ctx, firm.firmId, id)).id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/documents`, "layout");
  redirect(`/f/${slug}/documents/${newId}`);
}
export async function commentAction(slug: string, id: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => addComment(ctx, f, id, String(form.get("body") ?? "")), "Comment added.");
}
export async function resolveCommentAction(slug: string, id: string, commentId: string) {
  return run(slug, (f, ctx) => resolveComment(ctx, f, id, commentId), "Marked resolved.");
}
export async function aiDraftAction(slug: string, id: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    const r = await draftWithAi(ctx, firm.firmId, id, String(form.get("instructions") ?? ""));
    revalidatePath(`/f/${slug}/documents/${id}`);
    return { ok: true, message: `Draft ready with ${r.gaps.prompts.length} gap${r.gaps.prompts.length === 1 ? "" : "s"} flagged. Check every statement before sending it for review.` };
  } catch (err) {
    return toActionError(err);
  }
}
export async function rerunOcrAction(slug: string, fileId: string) {
  return run(slug, (f, ctx) => rerunOcr(ctx, f, fileId), "Text read again.");
}

export async function saveTemplateAction(slug: string, id: string | null, fields: { name: string; kind: string; description: string; letterhead: boolean }, content: unknown): Promise<ActionResult<{ id: string }>> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    const t = await saveTemplate(ctx, firm.firmId, id, fields, content);
    revalidatePath(`/f/${slug}/documents/templates`, "layout");
    return { ok: true, message: `Template saved (version ${t.version}).`, data: { id: t.id } };
  } catch (err) {
    return toActionError(err);
  }
}
export async function templateActiveAction(slug: string, id: string, active: boolean) {
  return run(slug, (f, ctx) => setTemplateActive(ctx, f, id, active), active ? "Template switched on." : "Template switched off.");
}
