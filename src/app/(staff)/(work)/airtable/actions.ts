"use server";

import { revalidatePath } from "next/cache";
import { toActionError, type ActionResult } from "@/server/errors";
import { setSourceEnabled, syncNow } from "@/server/modules/mirror/mirror";
import { requireStaff } from "@/server/next/session";

export async function syncNowAction(sourceId: string, kind: "full" | "incremental"): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    const r = await syncNow(ctx, sourceId, kind);
    revalidatePath("/airtable", "layout");
    if (r.status === "error") return { ok: false, error: `Sync failed: ${r.error}` };
    return { ok: true, message: `${kind === "full" ? "Full sync" : "Sync"} done: ${r.fetched} read, ${r.created} new, ${r.updated} changed${r.removed ? `, ${r.removed} marked removed` : ""}${r.restored ? `, ${r.restored} restored` : ""}.` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setSourceEnabledAction(sourceId: string, enabled: boolean): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await setSourceEnabled(ctx, sourceId, enabled);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/airtable", "layout");
  return { ok: true, message: enabled ? "Syncing resumed." : "Syncing paused." };
}
