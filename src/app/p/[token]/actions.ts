"use server";

import { revalidatePath } from "next/cache";
import { respondToProposal } from "@/server/modules/proposals/proposals";
import { requestMeta } from "@/server/next/session";

export type RespondState = { ok: boolean; message: string } | null;

const MESSAGES: Record<string, string> = {
  accepted: "Thank you. Your acceptance is recorded and we'll be in touch about the deposit.",
  declined: "Thank you for letting us know. Your consultant may contact you to discuss options.",
  already_accepted: "This proposal has already been accepted.",
  already_declined: "This proposal has already been declined.",
  expired: "This proposal has expired. Please ask your consultant for a new link.",
  not_found: "This link is invalid or has been replaced.",
  name_required: "Type your full name to confirm.",
};

export async function respondAction(token: string, _: RespondState, form: FormData): Promise<RespondState> {
  const accept = form.get("decision") === "accept";
  if (accept && form.get("agree") !== "on") return { ok: false, message: "Tick the box to confirm you accept the scope and fees." };
  const { ip } = await requestMeta();
  const r = await respondToProposal(token, { accept, name: String(form.get("name") ?? ""), note: String(form.get("note") ?? ""), ip });
  revalidatePath(`/p/${token}`);
  return { ok: r === "accepted" || r === "declined", message: MESSAGES[r] ?? MESSAGES.not_found };
}
