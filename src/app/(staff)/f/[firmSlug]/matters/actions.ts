"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/server/errors";
import {
  addCalculatedDeadline, addFact, addMatterMember, addMatterStage, addRecordedDate, adjustDate, changeMatterStage, completeDate, createMatter,
  moveMatterStage, removeFact, removeMatterMember, removePerson, saveDeadlineRule, savePerson, updateMatter, updateMatterStage, validateDeadlineRule, verifyFact,
} from "@/server/modules/matters/matters";
import { saveTaskTemplate, setTaskTemplateActive } from "@/server/modules/tasks/tasks";
import { requireFirm } from "@/server/next/session";

const data = (f: FormData) => Object.fromEntries([...f.keys()].map((k) => [k, f.getAll(k).length > 1 ? f.getAll(k).map(String) : String(f.get(k))]));

async function run(slug: string, fn: (firmId: string, ctx: Awaited<ReturnType<typeof requireFirm>>["ctx"]) => Promise<unknown>, message: string, path?: string): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await fn(firm.firmId, ctx);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(path ?? `/f/${slug}/matters`, "layout");
  return { ok: true, message };
}

export async function createMatterAction(slug: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  let id: string;
  try {
    id = (await createMatter(ctx, firm.firmId, data(form))).id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/matters`);
  redirect(`/f/${slug}/matters/${id}?opened=1`);
}

export async function updateMatterAction(slug: string, id: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => updateMatter(ctx, f, id, data(form)), "Matter saved.");
}

export async function changeMatterStageAction(slug: string, id: string, stageId: string): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    const { stage, tasksCreated } = await changeMatterStage(ctx, firm.firmId, id, stageId);
    revalidatePath(`/f/${slug}/matters`, "layout");
    return { ok: true, message: `Moved to ${stage.name}.${tasksCreated ? ` ${tasksCreated} task${tasksCreated === 1 ? "" : "s"} added.` : ""}` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function addMemberAction(slug: string, id: string, userId: string) {
  return run(slug, (f, ctx) => addMatterMember(ctx, f, id, userId), "Added to the team.");
}
export async function removeMemberAction(slug: string, id: string, userId: string) {
  return run(slug, (f, ctx) => removeMatterMember(ctx, f, id, userId), "Removed from the team.");
}

export async function savePersonAction(slug: string, matterId: string, personId: string | null, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => savePerson(ctx, f, matterId, personId, data(form)), personId ? "Person updated." : "Person added.");
}
export async function removePersonAction(slug: string, matterId: string, personId: string) {
  return run(slug, (f, ctx) => removePerson(ctx, f, matterId, personId), "Person removed.");
}

export async function addFactAction(slug: string, matterId: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => addFact(ctx, f, matterId, data(form)), "Fact recorded.");
}
export async function verifyFactAction(slug: string, matterId: string, factId: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => verifyFact(ctx, f, matterId, factId, String(form.get("evidence") ?? "")), "Marked as verified.");
}
export async function removeFactAction(slug: string, matterId: string, factId: string) {
  return run(slug, (f, ctx) => removeFact(ctx, f, matterId, factId), "Fact removed.");
}

export async function addRecordedDateAction(slug: string, matterId: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => addRecordedDate(ctx, f, matterId, data(form)), "Date added.");
}
export async function addCalculatedDeadlineAction(slug: string, matterId: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => addCalculatedDeadline(ctx, f, matterId, data(form)), "Deadline calculated.");
}
export async function adjustDateAction(slug: string, matterId: string, dateId: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => adjustDate(ctx, f, matterId, dateId, data(form)), "Date adjusted.");
}
export async function completeDateAction(slug: string, matterId: string, dateId: string, done: boolean) {
  return run(slug, (f, ctx) => completeDate(ctx, f, matterId, dateId, done), done ? "Marked done." : "Reopened.");
}

/* Settings */
export async function addMatterStageAction(slug: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => addMatterStage(ctx, f, data(form)), "Stage added.", `/f/${slug}/settings`);
}
export async function updateMatterStageAction(slug: string, stageId: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => updateMatterStage(ctx, f, stageId, data(form)), "Stage saved.", `/f/${slug}/settings`);
}
export async function moveMatterStageAction(slug: string, stageId: string, dir: "up" | "down") {
  return run(slug, (f, ctx) => moveMatterStage(ctx, f, stageId, dir), "Order saved.", `/f/${slug}/settings`);
}
export async function saveTaskTemplateAction(slug: string, templateId: string | null, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => saveTaskTemplate(ctx, f, templateId, data(form)), "Task template saved.", `/f/${slug}/settings`);
}
export async function setTaskTemplateActiveAction(slug: string, templateId: string, active: boolean) {
  return run(slug, (f, ctx) => setTaskTemplateActive(ctx, f, templateId, active), active ? "Template turned on." : "Template turned off.", `/f/${slug}/settings`);
}
export async function saveDeadlineRuleAction(slug: string, ruleId: string | null, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => saveDeadlineRule(ctx, f, ruleId, data(form)), "Rule saved. It needs validating before use.", `/f/${slug}/settings`);
}
export async function validateDeadlineRuleAction(slug: string, ruleId: string, valid: boolean) {
  return run(slug, (f, ctx) => validateDeadlineRule(ctx, f, ruleId, valid), valid ? "Rule validated." : "Rule withdrawn.", `/f/${slug}/settings`);
}
