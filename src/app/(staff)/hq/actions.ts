"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createInvitation, revokeInvitation } from "@/server/auth/service";
import { toActionError, type ActionResult } from "@/server/errors";
import { captureIntake, moveRule, previewRouting, routeIntakeItem, saveRule, setIntakeStatus } from "@/server/modules/intake/intake";
import { createFirm, joinFirmAsGroupAdmin, updateFirmProfile } from "@/server/modules/org/firms";
import { deactivateUser, endUserSessions, reactivateUser, setGroupRole } from "@/server/modules/people/people";
import { requireStaff } from "@/server/next/session";

const data = (f: FormData) => Object.fromEntries([...f.keys()].map((k) => [k, String(f.get(k))]));
const str = (f: FormData, k: string) => String(f.get(k) ?? "");

/* ───────── Intake ───────── */

export async function captureIntakeAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  let id: string;
  try {
    id = (await captureIntake(ctx, data(form))).item.id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/hq", "layout");
  redirect(`/hq/intake/${id}`);
}

export async function routeIntakeAction(itemId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    const r = await routeIntakeItem(ctx, itemId, str(form, "firmId"), str(form, "note"));
    revalidatePath("/hq", "layout");
    return { ok: true, message: `Routed to ${r.firmName} as ${r.leadRef}.` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setIntakeStatusAction(itemId: string, status: "held" | "rejected" | "duplicate" | "new", note?: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await setIntakeStatus(ctx, itemId, status, note);
    revalidatePath("/hq", "layout");
    return { ok: true, message: status === "new" ? "Reopened." : status === "held" ? "Held for review." : "Closed." };
  } catch (err) {
    return toActionError(err);
  }
}

/* ───────── Routing ───────── */

export async function saveRuleAction(ruleId: string | null, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await saveRule(ctx, ruleId, data(form));
    revalidatePath("/hq/routing");
    return { ok: true, message: ruleId ? "Rule saved." : "Rule added." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function moveRuleAction(ruleId: string, direction: "up" | "down"): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await moveRule(ctx, ruleId, direction);
    revalidatePath("/hq/routing");
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function previewRoutingAction(_: unknown, form: FormData) {
  const { ctx } = await requireStaff();
  try {
    return { ok: true as const, decision: await previewRouting(ctx, { enquiry: str(form, "enquiry"), currentCountry: str(form, "currentCountry") || undefined, destinationCountry: str(form, "destinationCountry") || undefined }) };
  } catch (err) {
    return toActionError(err);
  }
}

/* ───────── Firms ───────── */

export async function createFirmAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  let slug: string;
  try {
    slug = (await createFirm(ctx, data(form))).slug;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/hq", "layout");
  redirect(`/f/${slug}/settings`);
}

export async function updateFirmFromHqAction(firmId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await updateFirmProfile(ctx, firmId, data(form));
    revalidatePath("/hq/firms");
    return { ok: true, message: "Firm profile saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function joinFirmAction(firmId: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await joinFirmAsGroupAdmin(ctx, firmId);
    revalidatePath("/", "layout");
    return { ok: true, message: "You've joined the firm as Firm Administrator. This was recorded in the audit log." };
  } catch (err) {
    return toActionError(err);
  }
}

/* ───────── People ───────── */

export async function inviteStaffAction(_: ActionResult<{ link: string; emailStatus: string }> | null, form: FormData): Promise<ActionResult<{ link: string; emailStatus: string }>> {
  const { ctx } = await requireStaff();
  try {
    const r = await createInvitation(ctx, { email: str(form, "email"), name: str(form, "name"), roleId: str(form, "roleId"), firmId: str(form, "firmId") || null });
    revalidatePath("/hq/people");
    return { ok: true, data: { link: r.link, emailStatus: r.email.status } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function revokeStaffInvitationAction(id: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await revokeInvitation(ctx, id);
    revalidatePath("/hq/people");
    return { ok: true, message: "Invitation cancelled." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setGroupRoleAction(userId: string, roleId: string | null): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await setGroupRole(ctx, userId, roleId);
    revalidatePath("/hq/people");
    return { ok: true, message: "Group role updated." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    if (active) await reactivateUser(ctx, userId);
    else await deactivateUser(ctx, userId);
    revalidatePath("/hq/people");
    return { ok: true, message: active ? "Account reactivated." : "Account deactivated and signed out everywhere." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function endSessionsAction(userId: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await endUserSessions(ctx, userId);
    return { ok: true, message: "Signed out everywhere." };
  } catch (err) {
    return toActionError(err);
  }
}
