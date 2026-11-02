"use server";

import { revalidatePath } from "next/cache";
import { queueReply, type ReplyInput } from "@/server/modules/conversations/conversations";
import { requireStaff } from "@/server/next/session";

export type ReplyResult = { ok: true } | { ok: false; error: string };

/** Queue a reply; the engine sends it and the row shows the result. */
export async function sendReplyAction(leadId: string, input: ReplyInput): Promise<ReplyResult> {
  const { ctx } = await requireStaff();
  try {
    const r = await queueReply(ctx, leadId, input);
    if ("error" in r) return { ok: false, error: r.error };
  } catch {
    return { ok: false, error: "The reply could not be saved. Please try again." };
  }
  revalidatePath("/conversations");
  return { ok: true };
}
