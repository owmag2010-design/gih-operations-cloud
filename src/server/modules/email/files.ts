import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Tx } from "../../db/client";
import { storedFiles } from "../../db/schema";
import { NotFoundError, ValidationError } from "../../errors";
import { requireSendInbox, requireViewInbox, scopeForFirm } from "./access";

/** Per file. Uploads also pass through the hosting platform's ~4.5 MB request limit. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Per message, all attachments together (provider limits are 25–35 MB; base64 adds a third). */
export const MAX_MESSAGE_ATTACHMENT_BYTES = 18 * 1024 * 1024;

const BLOCKED = /\.(exe|bat|cmd|com|scr|js|vbs|msi|ps1|jar|sh|app|dmg)$/i;

export function safeFilename(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[\x00-\x1f"<>|*?:]/g, "_").slice(0, 160) || "file";
}

/** Store a file a user is attaching to an email. */
export async function uploadAttachment(ctx: AccessContext, firmId: string | null, file: { name: string; type: string; data: Buffer }) {
  requireSendInbox(ctx, firmId);
  if (!file.data.length) throw new ValidationError("That file is empty.");
  if (file.data.length > MAX_UPLOAD_BYTES) throw new ValidationError(`Files can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB each.`);
  const filename = safeFilename(file.name);
  if (BLOCKED.test(filename)) throw new ValidationError("Programs and scripts can't be attached.");
  const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : "application/octet-stream";
  return withScope(scopeForFirm(ctx, firmId), async (tx) => {
    const [row] = await tx
      .insert(storedFiles)
      .values({ orgId: ctx.orgId, firmId, filename, contentType, size: file.data.length, sha256: createHash("sha256").update(file.data).digest("hex"), data: file.data, source: "upload", createdById: ctx.user.id })
      .returning({ id: storedFiles.id, filename: storedFiles.filename, size: storedFiles.size, contentType: storedFiles.contentType });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "file.uploaded", entityType: "stored_file", entityId: row.id, summary: `Uploaded ${row.filename}`, ip: ctx.ip }, tx);
    return row;
  });
}

/** Attachments chosen for a message: must be in the same practice (or Hub) and uploaded by this user. */
export async function loadAttachmentsTx(tx: Tx, ctx: AccessContext, firmId: string | null, ids: string[]) {
  const clean = [...new Set(ids)].filter((i) => z.string().uuid().safeParse(i).success);
  if (!clean.length) return [];
  const rows = await tx.select().from(storedFiles).where(and(inArray(storedFiles.id, clean), eq(storedFiles.orgId, ctx.orgId)));
  const ok = rows.filter((r) => (r.firmId ?? null) === firmId && (r.createdById === ctx.user.id || r.source !== "upload"));
  if (ok.length !== clean.length) throw new ValidationError("One of the attachments isn't available. Remove it and attach it again.");
  const total = ok.reduce((n, r) => n + r.size, 0);
  if (total > MAX_MESSAGE_ATTACHMENT_BYTES) throw new ValidationError(`Attachments can total up to ${MAX_MESSAGE_ATTACHMENT_BYTES / 1024 / 1024} MB per message.`);
  return ok;
}

/** Read a stored file the user may see (by practice). */
export async function readFile(ctx: AccessContext, fileId: string) {
  if (!z.string().uuid().safeParse(fileId).success) throw new NotFoundError("File");
  const firmIds = [...ctx.firms.values()].filter((f) => f.permissions.has("email:view")).map((f) => f.firmId);
  return withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds, intake: ctx.has("intake:view") }, async (tx) => {
    const [f] = await tx.select().from(storedFiles).where(eq(storedFiles.id, fileId));
    if (!f) throw new NotFoundError("File");
    requireViewInbox(ctx, f.firmId);
    return f;
  });
}
