"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createInvitation, revokeInvitation } from "@/server/auth/service";
import { toActionError, type ActionResult } from "@/server/errors";
import { addClientNote, createClient, updateClient } from "@/server/modules/clients/clients";
import { addLeadNote, assignLeads, changeStage, convertLead, createLead, deleteLeads, markDuplicate, recordLeadConsent, updateLead } from "@/server/modules/crm/leads";
import { createSavedView, deleteSavedView } from "@/server/modules/crm/views";
import { addDepartment, addStage, moveStage, updateFirmPolicies, updateFirmProfile, updateStage } from "@/server/modules/org/firms";
import { changeFirmRole, removeFirmMembership, updateMembershipDetails } from "@/server/modules/people/people";
import { createService, updateService } from "@/server/modules/services/services";
import {
  addProposalItem, approveProposal, createProposalFromLead, releaseProposal, removeProposalItem, renewLink, requestChanges,
  reviseProposal, submitForReview, updateProposal, updateProposalItem, withdrawProposal,
} from "@/server/modules/proposals/proposals";
import { requireFirm } from "@/server/next/session";

const data = (f: FormData) => Object.fromEntries([...f.keys()].map((k) => [k, f.getAll(k).length > 1 ? f.getAll(k).map(String) : String(f.get(k))]));
const str = (f: FormData, k: string) => String(f.get(k) ?? "");

/* ───────── Leads ───────── */

export async function createLeadAction(slug: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  let id: string;
  try {
    const { lead } = await createLead(ctx, firm.firmId, data(form));
    id = lead.id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/leads`);
  redirect(`/f/${slug}/leads/${id}?created=1`);
}

export async function updateLeadAction(slug: string, leadId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await updateLead(ctx, firm.firmId, leadId, data(form));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/leads/${leadId}`);
  redirect(`/f/${slug}/leads/${leadId}`);
}

export async function changeStageAction(slug: string, leadIds: string[], stageId: string): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    const { moved, stage } = await changeStage(ctx, firm.firmId, leadIds, stageId);
    revalidatePath(`/f/${slug}/leads`, "layout");
    return { ok: true, message: moved === 1 ? `Moved to ${stage.name}.` : `Moved ${moved} leads to ${stage.name}.` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function assignLeadsAction(slug: string, leadIds: string[], userId: string | null): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    const { changed } = await assignLeads(ctx, firm.firmId, leadIds, userId);
    revalidatePath(`/f/${slug}/leads`, "layout");
    return { ok: true, message: userId ? `Assigned ${changed} lead${changed === 1 ? "" : "s"}.` : `Unassigned ${changed} lead${changed === 1 ? "" : "s"}.` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteLeadsAction(slug: string, leadIds: string[]): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    const { removed } = await deleteLeads(ctx, firm.firmId, leadIds);
    revalidatePath(`/f/${slug}/leads`);
    return { ok: true, message: `Deleted ${removed} lead${removed === 1 ? "" : "s"}.` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function addLeadNoteAction(slug: string, leadId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await addLeadNote(ctx, firm.firmId, leadId, str(form, "body"));
    revalidatePath(`/f/${slug}/leads/${leadId}`);
    return { ok: true, message: "Note added." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function recordConsentAction(slug: string, leadId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await recordLeadConsent(ctx, firm.firmId, leadId, data(form));
    revalidatePath(`/f/${slug}/leads/${leadId}`);
    return { ok: true, message: "Consent recorded." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function markDuplicateAction(slug: string, leadId: string, originalId: string): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await markDuplicate(ctx, firm.firmId, leadId, originalId);
    revalidatePath(`/f/${slug}/leads/${leadId}`);
    return { ok: true, message: "Marked as a duplicate." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function convertLeadAction(slug: string, leadId: string): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  let clientId: string;
  try {
    const { client } = await convertLead(ctx, firm.firmId, leadId);
    clientId = client.id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}`, "layout");
  redirect(`/f/${slug}/clients/${clientId}?converted=1`);
}

export async function saveViewAction(slug: string, query: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await createSavedView(ctx, firm.firmId, str(form, "name"), query, form.get("shared") === "on");
    revalidatePath(`/f/${slug}/leads`);
    return { ok: true, message: "View saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteViewAction(slug: string, viewId: string): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await deleteSavedView(ctx, firm.firmId, viewId);
    revalidatePath(`/f/${slug}/leads`);
    return { ok: true, message: "View removed." };
  } catch (err) {
    return toActionError(err);
  }
}

/* ───────── Clients ───────── */

export async function createClientAction(slug: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  let id: string;
  try {
    id = (await createClient(ctx, firm.firmId, data(form))).id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/clients`);
  redirect(`/f/${slug}/clients/${id}`);
}

export async function updateClientAction(slug: string, clientId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await updateClient(ctx, firm.firmId, clientId, data(form));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/clients/${clientId}`);
  redirect(`/f/${slug}/clients/${clientId}`);
}

export async function addClientNoteAction(slug: string, clientId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await addClientNote(ctx, firm.firmId, clientId, str(form, "body"));
    revalidatePath(`/f/${slug}/clients/${clientId}`);
    return { ok: true, message: "Note added." };
  } catch (err) {
    return toActionError(err);
  }
}

/* ───────── Team ───────── */

export async function inviteToFirmAction(slug: string, _: ActionResult<{ link: string; emailStatus: string }> | null, form: FormData): Promise<ActionResult<{ link: string; emailStatus: string }>> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    const r = await createInvitation(ctx, { email: str(form, "email"), name: str(form, "name"), roleId: str(form, "roleId"), firmId: firm.firmId });
    revalidatePath(`/f/${slug}/team`);
    return { ok: true, data: { link: r.link, emailStatus: r.email.status }, message: r.email.status === "sent" ? "Invitation sent." : undefined };
  } catch (err) {
    return toActionError(err);
  }
}

export async function revokeInvitationAction(slug: string, invitationId: string): Promise<ActionResult> {
  const { ctx } = await requireFirm(slug);
  try {
    await revokeInvitation(ctx, invitationId);
    revalidatePath(`/f/${slug}/team`);
    return { ok: true, message: "Invitation cancelled." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function changeRoleAction(slug: string, membershipId: string, roleId: string): Promise<ActionResult> {
  const { ctx } = await requireFirm(slug);
  try {
    await changeFirmRole(ctx, membershipId, roleId);
    revalidatePath(`/f/${slug}/team`);
    return { ok: true, message: "Role updated." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateMemberAction(slug: string, membershipId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireFirm(slug);
  try {
    await updateMembershipDetails(ctx, membershipId, { title: str(form, "title"), departmentId: str(form, "departmentId") || null });
    revalidatePath(`/f/${slug}/team`);
    return { ok: true, message: "Saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function removeMemberAction(slug: string, membershipId: string): Promise<ActionResult> {
  const { ctx } = await requireFirm(slug);
  try {
    await removeFirmMembership(ctx, membershipId);
    revalidatePath(`/f/${slug}/team`);
    return { ok: true, message: "Removed from the firm." };
  } catch (err) {
    return toActionError(err);
  }
}

/* ───────── Settings ───────── */

export async function updateProfileAction(slug: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await updateFirmProfile(ctx, firm.firmId, data(form));
    revalidatePath(`/f/${slug}`, "layout");
    return { ok: true, message: "Firm profile saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updatePoliciesAction(slug: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await updateFirmPolicies(ctx, firm.firmId, data(form));
    revalidatePath(`/f/${slug}/settings`);
    return { ok: true, message: "Policies saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function addStageAction(slug: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await addStage(ctx, firm.firmId, data(form));
    revalidatePath(`/f/${slug}/settings`);
    return { ok: true, message: "Stage added." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateStageAction(slug: string, stageId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await updateStage(ctx, firm.firmId, stageId, data(form));
    revalidatePath(`/f/${slug}/settings`);
    return { ok: true, message: "Stage saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function moveStageAction(slug: string, stageId: string, direction: "up" | "down"): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await moveStage(ctx, firm.firmId, stageId, direction);
    revalidatePath(`/f/${slug}/settings`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function addDepartmentAction(slug: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await addDepartment(ctx, firm.firmId, str(form, "name"));
    revalidatePath(`/f/${slug}/settings`);
    return { ok: true, message: "Department added." };
  } catch (err) {
    return toActionError(err);
  }
}

/* ───────── Services and fees ───────── */

function serviceInput(form: FormData) {
  const labels = form.getAll("lineLabel").map(String);
  const amounts = form.getAll("lineAmount").map(String);
  const kinds = form.getAll("lineKind").map(String);
  return {
    name: str(form, "name"), category: str(form, "category"), jurisdiction: str(form, "jurisdiction"), currency: str(form, "currency"),
    deposit: str(form, "deposit"), isActive: form.get("isActive") === "on", reason: str(form, "reason"),
    lines: labels.map((label, i) => ({ label, amount: amounts[i] ?? "", kind: kinds[i] ?? "third_party" })),
  };
}

export async function updateServiceAction(slug: string, serviceId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    const { version } = await updateService(ctx, firm.firmId, serviceId, serviceInput(form));
    revalidatePath(`/f/${slug}/settings`, "layout");
    return { ok: true, message: `Saved as version ${version}.` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function createServiceAction(slug: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  let id: string;
  try {
    id = (await createService(ctx, firm.firmId, serviceInput(form))).id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/settings`, "layout");
  redirect(`/f/${slug}/settings/services/${id}`);
}

/* ───────── Proposals ───────── */

export async function createProposalAction(slug: string, leadId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  let id: string;
  try {
    id = (await createProposalFromLead(ctx, firm.firmId, leadId, { serviceIds: form.getAll("serviceId").map(String).filter(Boolean) })).id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/proposals`);
  redirect(`/f/${slug}/proposals/${id}`);
}

export type ProposalDetailsPayload = { title: string; recipientName: string; recipientEmail: string; validDays: number; currency: string; sections: { key: string; title: string; body: string }[] };

export async function saveProposalAction(slug: string, id: string, payload: ProposalDetailsPayload): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await updateProposal(ctx, firm.firmId, id, payload);
    revalidatePath(`/f/${slug}/proposals/${id}`);
    return { ok: true, message: "Proposal saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function addProposalItemAction(slug: string, id: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    const serviceId = str(form, "serviceId");
    await addProposalItem(ctx, firm.firmId, id, serviceId ? { serviceId } : { label: str(form, "label"), description: str(form, "description"), quantity: str(form, "quantity") || "1", unit: str(form, "unit"), deposit: str(form, "deposit") });
    revalidatePath(`/f/${slug}/proposals/${id}`);
    return { ok: true, message: "Item added." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateProposalItemAction(slug: string, id: string, itemId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await updateProposalItem(ctx, firm.firmId, id, itemId, { label: str(form, "label"), description: str(form, "description"), quantity: str(form, "quantity") || "1", unit: str(form, "unit"), deposit: str(form, "deposit") });
    revalidatePath(`/f/${slug}/proposals/${id}`);
    return { ok: true, message: "Item updated." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function removeProposalItemAction(slug: string, id: string, itemId: string): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await removeProposalItem(ctx, firm.firmId, id, itemId);
    revalidatePath(`/f/${slug}/proposals/${id}`);
    return { ok: true, message: "Item removed." };
  } catch (err) {
    return toActionError(err);
  }
}

type Step = "submit" | "approve" | "release" | "renew" | "withdraw" | "revise" | "changes";

export async function proposalStepAction(slug: string, id: string, step: Step, note?: string): Promise<ActionResult<{ url?: string; validUntil?: string }>> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    let data: { url?: string; validUntil?: string } | undefined;
    let message = "";
    switch (step) {
      case "submit": await submitForReview(ctx, firm.firmId, id); message = "Sent for review."; break;
      case "approve": await approveProposal(ctx, firm.firmId, id); message = "Approved. It can now be sent to the client."; break;
      case "changes": await requestChanges(ctx, firm.firmId, id, note ?? ""); message = "Sent back for changes."; break;
      case "release": data = await releaseProposal(ctx, firm.firmId, id); message = "Proposal sent. Copy the client link now."; break;
      case "renew": data = await renewLink(ctx, firm.firmId, id, 14); message = "New link created. The old link no longer works."; break;
      case "withdraw": await withdrawProposal(ctx, firm.firmId, id); message = "Proposal withdrawn."; break;
      case "revise": await reviseProposal(ctx, firm.firmId, id); message = "Reopened for editing."; break;
    }
    revalidatePath(`/f/${slug}/proposals`, "layout");
    return { ok: true, message, data };
  } catch (err) {
    return toActionError(err);
  }
}
