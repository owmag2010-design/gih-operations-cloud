import "server-only";
import { and, asc, eq, or } from "drizzle-orm";
import type { AccessContext } from "../../access/context";
import { withScope } from "../../db/client";
import { savedViews } from "../../db/schema";
import { NotFoundError, ValidationError } from "../../errors";

/** Saved lead views: private to their owner unless shared with the firm. */
export async function listSavedViews(ctx: AccessContext, firmId: string) {
  ctx.require("firm:view", firmId);
  return withScope(ctx.scopeFor(firmId), (tx) =>
    tx
      .select()
      .from(savedViews)
      .where(and(eq(savedViews.firmId, firmId), eq(savedViews.entity, "leads"), or(eq(savedViews.userId, ctx.user.id), eq(savedViews.isShared, true))))
      .orderBy(asc(savedViews.name)),
  );
}

export async function createSavedView(ctx: AccessContext, firmId: string, name: string, query: string, isShared: boolean) {
  ctx.require("firm:view", firmId);
  const n = name.trim();
  if (n.length < 2 || n.length > 60) throw new ValidationError("Name the view (2–60 characters).", { name: "2–60 characters." });
  // Keep only known filter keys so nothing else rides along in the stored string.
  const allowed = new URLSearchParams();
  const src = new URLSearchParams(query);
  for (const k of ["q", "stage", "assignee", "priority", "source", "tag", "followUp", "status", "sort", "dir", "view"]) for (const v of src.getAll(k)) allowed.append(k, v.slice(0, 120));
  if (isShared && !ctx.has("firm:manage", firmId)) throw new ValidationError("Only firm administrators can share views with the whole firm.");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [v] = await tx.insert(savedViews).values({ firmId, userId: ctx.user.id, name: n, query: allowed.toString(), isShared }).returning();
    return v;
  });
}

export async function deleteSavedView(ctx: AccessContext, firmId: string, viewId: string) {
  ctx.require("firm:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const deleted = await tx.delete(savedViews).where(and(eq(savedViews.id, viewId), eq(savedViews.userId, ctx.user.id))).returning({ id: savedViews.id });
    if (!deleted.length) throw new NotFoundError("View");
  });
}
