"use server";

import { setActiveFirm } from "@/server/auth/sessions";
import { globalSearch, type SearchHit } from "@/server/modules/search";
import { requireStaff } from "@/server/next/session";

export async function searchAction(q: string): Promise<SearchHit[]> {
  const { ctx } = await requireStaff();
  return globalSearch(ctx, String(q ?? ""));
}

/** Remember the firm last opened so sign-in lands there next time. */
export async function rememberFirmAction(firmId: string) {
  const { ctx, session } = await requireStaff();
  if (ctx.firms.has(firmId) && session.activeFirmId !== firmId) await setActiveFirm(session.id, firmId);
}
