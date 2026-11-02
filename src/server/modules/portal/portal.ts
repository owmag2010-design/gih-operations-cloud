import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { decrypt, encrypt, randomToken, sha256 } from "../../auth/crypto";
import { withScope } from "../../db/client";
import { activities, clients, documentFiles, firms, portalAccess, portalChecklistItems, portalMessages, portalUploads, users } from "../../db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../errors";
import { sendEmail } from "../../integrations/email";
import { driveFileName, parseDriveFolderId, serviceAccount, uploadToDrive } from "../../integrations/google-drive";
import { parseOrThrow } from "../../validation";
import { loadVisibleMatter } from "../matters/matters";
import { portalLink } from "./client";
import { clientEmail } from "./emails";

/**
 * The staff side of the client portal, shown on the matter page. Reading needs
 * the matter to be visible to the person; changing anything needs matters:edit.
 */

function requireEdit(ctx: AccessContext, firmId: string) {
  if (!ctx.has("matters:edit", firmId)) throw new AccessDeniedError("matters:edit");
}

export async function getPortalPanel(ctx: AccessContext, firmId: string, matterId: string) {
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const matter = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const [access] = await tx.select().from(portalAccess).where(and(eq(portalAccess.matterId, matter.id), isNull(portalAccess.revokedAt))).limit(1);
    const checklist = await tx.select().from(portalChecklistItems).where(eq(portalChecklistItems.matterId, matter.id)).orderBy(asc(portalChecklistItems.position), asc(portalChecklistItems.createdAt));
    const messages = await tx
      .select({ m: portalMessages, authorName: users.name })
      .from(portalMessages)
      .leftJoin(users, eq(users.id, portalMessages.authorUserId))
      .where(eq(portalMessages.matterId, matter.id))
      .orderBy(asc(portalMessages.createdAt));
    const uploads = await tx.select().from(portalUploads).where(eq(portalUploads.matterId, matter.id)).orderBy(desc(portalUploads.createdAt));
    const [client] = await tx.select({ firstName: clients.firstName, lastName: clients.lastName, email: clients.email }).from(clients).where(eq(clients.id, matter.clientId));
    return {
      matter: { id: matter.id, ref: matter.ref, title: matter.title },
      client,
      access: access
        ? { id: access.id, email: access.email, link: safeDecrypt(access.tokenEnc), driveFolderId: access.driveFolderId, invitedAt: access.invitedAt, lastSeenAt: access.lastSeenAt, createdAt: access.createdAt }
        : null,
      checklist,
      messages: messages.map((r) => ({ ...r.m, authorName: r.m.authorKind === "client" ? `${client?.firstName ?? "Client"}${client?.lastName ? ` ${client.lastName}` : ""}` : (r.authorName ?? "Staff") })),
      uploads,
      driveConnected: !!serviceAccount(),
      canEdit: ctx.has("matters:edit", firmId),
    };
  });
}

function safeDecrypt(enc: string): string | null {
  try {
    return portalLink(decrypt(enc));
  } catch {
    return null;
  }
}

const enableSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter the client's email address."),
  driveFolder: z.string().trim().max(400).optional().default(""),
  sendInvite: z.union([z.literal("on"), z.literal("true"), z.literal(""), z.boolean()]).optional().transform((v) => v === true || v === "on" || v === "true"),
});

/** Open (or replace) the portal for a matter. A replaced link stops working at once. */
export async function enablePortal(ctx: AccessContext, firmId: string, matterId: string, raw: unknown) {
  requireEdit(ctx, firmId);
  const input = parseOrThrow(enableSchema, raw);
  const driveFolderId = input.driveFolder ? parseDriveFolderId(input.driveFolder) : null;
  if (input.driveFolder && !driveFolderId) throw new ValidationError("Paste the Google Drive folder link or its id.", { driveFolder: "Paste the Google Drive folder link or its id." });
  const token = randomToken();

  const out = await withScope(ctx.scopeFor(firmId), async (tx) => {
    const matter = await loadVisibleMatter(tx, ctx, firmId, matterId, true);
    const now = new Date();
    const replaced = await tx.update(portalAccess).set({ revokedAt: now }).where(and(eq(portalAccess.matterId, matter.id), isNull(portalAccess.revokedAt))).returning({ id: portalAccess.id });
    const [row] = await tx
      .insert(portalAccess)
      .values({ firmId, matterId: matter.id, clientId: matter.clientId, email: input.email, tokenHash: sha256(token), tokenEnc: encrypt(token), driveFolderId, createdById: ctx.user.id })
      .returning();
    await tx.insert(activities).values({ firmId, clientId: matter.clientId, matterId: matter.id, type: "matter", body: replaced.length ? "Client portal link replaced" : "Client portal opened", data: { portalAccessId: row.id }, actorId: ctx.user.id });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: replaced.length ? "portal.link_replaced" : "portal.opened", entityType: "matter", entityId: matter.id, summary: `Client portal for ${matter.ref}`, ip: ctx.ip }, tx);
    const [client] = await tx.select({ firstName: clients.firstName }).from(clients).where(eq(clients.id, matter.clientId));
    const [firm] = await tx.select({ name: firms.tradingName }).from(firms).where(eq(firms.id, firmId));
    return { accessId: row.id, matter, firstName: client?.firstName ?? "", firmName: firm?.name ?? "" };
  });

  const link = portalLink(token);
  let invite: "sent" | "not_configured" | "failed" | "not_sent" = "not_sent";
  if (input.sendInvite) {
    invite = await sendInvite(ctx, firmId, { accessId: out.accessId, email: input.email, firstName: out.firstName, firmName: out.firmName, ref: out.matter.ref, title: out.matter.title, link });
  }
  return { link, invite };
}

async function sendInvite(ctx: AccessContext, firmId: string, p: { accessId: string; email: string; firstName: string; firmName: string; ref: string; title: string; link: string }) {
  const mail = clientEmail({
    kicker: "Your application portal",
    heading: p.title,
    subline: `Reference ${p.ref} · ${p.firmName}, a Global Immigration Hub partner firm`,
    greeting: `Dear ${p.firstName || "client"},`,
    body: [
      "Your private portal is ready. It shows where your application stands, the documents we still need, and messages from your team, from start to finish.",
      "Open it with the button below. We'll email you a six-digit code to confirm it's you; there is no password to remember.",
    ],
    panelTitle: "In your portal",
    panelLines: ["Your application journey, stage by stage", "Your document checklist, with secure uploads", "Messages with your team"],
    actionLabel: "Open my portal",
    actionUrl: p.link,
    footer: "This link is private to you. Please don't forward it. Upload documents through the portal or email them to your team; we don't accept documents on WhatsApp.",
  });
  const res = await sendEmail({ orgId: ctx.orgId, firmId, to: p.email, subject: `Your application portal · ${p.ref}`, template: "portal_invite", ...mail });
  if (res.status !== "failed") {
    await withScope(ctx.scopeFor(firmId), (tx) => tx.update(portalAccess).set({ invitedAt: new Date() }).where(eq(portalAccess.id, p.accessId)));
  }
  return res.status;
}

/** Email the current link again. */
export async function resendInvite(ctx: AccessContext, firmId: string, matterId: string) {
  requireEdit(ctx, firmId);
  const d = await withScope(ctx.scopeFor(firmId), async (tx) => {
    const matter = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const [a] = await tx.select().from(portalAccess).where(and(eq(portalAccess.matterId, matter.id), isNull(portalAccess.revokedAt))).limit(1);
    if (!a) throw new NotFoundError("Client portal");
    const [client] = await tx.select({ firstName: clients.firstName }).from(clients).where(eq(clients.id, matter.clientId));
    const [firm] = await tx.select({ name: firms.tradingName }).from(firms).where(eq(firms.id, firmId));
    return { a, matter, firstName: client?.firstName ?? "", firmName: firm?.name ?? "" };
  });
  const link = safeDecrypt(d.a.tokenEnc);
  if (!link) throw new ValidationError("This link can't be read any more. Replace the link to send a new one.");
  return sendInvite(ctx, firmId, { accessId: d.a.id, email: d.a.email, firstName: d.firstName, firmName: d.firmName, ref: d.matter.ref, title: d.matter.title, link });
}

export async function updatePortalDriveFolder(ctx: AccessContext, firmId: string, matterId: string, folder: string) {
  requireEdit(ctx, firmId);
  const id = folder.trim() ? parseDriveFolderId(folder) : null;
  if (folder.trim() && !id) throw new ValidationError("Paste the Google Drive folder link or its id.", { driveFolder: "Paste the Google Drive folder link or its id." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const matter = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const res = await tx.update(portalAccess).set({ driveFolderId: id }).where(and(eq(portalAccess.matterId, matter.id), isNull(portalAccess.revokedAt))).returning({ id: portalAccess.id });
    if (!res.length) throw new NotFoundError("Client portal");
    return id;
  });
}

export async function closePortal(ctx: AccessContext, firmId: string, matterId: string) {
  requireEdit(ctx, firmId);
  await withScope(ctx.scopeFor(firmId), async (tx) => {
    const matter = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const res = await tx.update(portalAccess).set({ revokedAt: new Date() }).where(and(eq(portalAccess.matterId, matter.id), isNull(portalAccess.revokedAt))).returning({ id: portalAccess.id });
    if (!res.length) throw new NotFoundError("Client portal");
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "portal.closed", entityType: "matter", entityId: matter.id, summary: `Closed the client portal for ${matter.ref}`, ip: ctx.ip }, tx);
  });
}

/* ───────── Checklist ───────── */

const itemSchema = z.object({
  label: z.string().trim().min(2, "Name the document.").max(160),
  group: z.string().trim().max(80).optional().default(""),
});

export async function addChecklistItems(ctx: AccessContext, firmId: string, matterId: string, raw: unknown) {
  requireEdit(ctx, firmId);
  // One document per line; "Group: Label" sets the group.
  const lines = String((raw as { labels?: string })?.labels ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 60);
  if (!lines.length) throw new ValidationError("Add at least one document.", { labels: "Add at least one document." });
  const items = lines.map((l) => {
    const m = l.match(/^([^:]{2,80}):\s*(.+)$/);
    return parseOrThrow(itemSchema, m ? { group: m[1], label: m[2] } : { label: l });
  });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const matter = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${portalChecklistItems.position}), 0)::int` }).from(portalChecklistItems).where(eq(portalChecklistItems.matterId, matter.id));
    return tx
      .insert(portalChecklistItems)
      .values(items.map((it, i) => ({ firmId, matterId: matter.id, label: it.label, groupLabel: it.group || null, position: max + i + 1, createdById: ctx.user.id })))
      .returning();
  });
}

export async function setChecklistStatus(ctx: AccessContext, firmId: string, matterId: string, itemId: string, status: string) {
  requireEdit(ctx, firmId);
  if (!["needed", "uploaded", "accepted", "waived"].includes(status)) throw new ValidationError("Choose a status.");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const matter = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const res = await tx
      .update(portalChecklistItems)
      .set({ status: status as "needed", updatedAt: new Date() })
      .where(and(eq(portalChecklistItems.id, itemId), eq(portalChecklistItems.matterId, matter.id)))
      .returning();
    if (!res.length) throw new NotFoundError("Checklist item");
    return res[0];
  });
}

export async function removeChecklistItem(ctx: AccessContext, firmId: string, matterId: string, itemId: string) {
  requireEdit(ctx, firmId);
  await withScope(ctx.scopeFor(firmId), async (tx) => {
    const matter = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const res = await tx.delete(portalChecklistItems).where(and(eq(portalChecklistItems.id, itemId), eq(portalChecklistItems.matterId, matter.id))).returning({ id: portalChecklistItems.id });
    if (!res.length) throw new NotFoundError("Checklist item");
  });
}

/* ───────── Messages ───────── */

const messageSchema = z.object({
  body: z.string().trim().min(1, "Write a message.").max(4000),
  internal: z.union([z.literal("on"), z.literal("true"), z.literal(""), z.boolean()]).optional().transform((v) => v === true || v === "on" || v === "true"),
});

/** A staff reply (the client gets a short email with a link) or an internal note (nobody outside the team sees it). */
export async function postStaffMessage(ctx: AccessContext, firmId: string, matterId: string, raw: unknown) {
  requireEdit(ctx, firmId);
  const input = parseOrThrow(messageSchema, raw);
  const d = await withScope(ctx.scopeFor(firmId), async (tx) => {
    const matter = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const [a] = await tx.select().from(portalAccess).where(and(eq(portalAccess.matterId, matter.id), isNull(portalAccess.revokedAt))).limit(1);
    if (!a && !input.internal) throw new ValidationError("Open the client portal before sending the client a message.");
    const [m] = await tx.insert(portalMessages).values({ firmId, matterId: matter.id, authorKind: "staff", authorUserId: ctx.user.id, internal: input.internal, body: input.body }).returning();
    const [client] = await tx.select({ firstName: clients.firstName }).from(clients).where(eq(clients.id, matter.clientId));
    const [firm] = await tx.select({ name: firms.tradingName }).from(firms).where(eq(firms.id, firmId));
    return { m, a, matter, firstName: client?.firstName ?? "", firmName: firm?.name ?? "" };
  });
  let notified: "sent" | "not_configured" | "failed" | "not_sent" = "not_sent";
  if (!input.internal && d.a) {
    const link = safeDecrypt(d.a.tokenEnc);
    if (link) {
      const mail = clientEmail({
        kicker: "New message from your team",
        heading: d.matter.title,
        subline: `Reference ${d.matter.ref} · ${d.firmName}`,
        greeting: `Dear ${d.firstName || "client"},`,
        body: ["Your team has sent you a message about your application. Open your portal to read it and reply."],
        actionLabel: "Read the message",
        actionUrl: link,
        footer: "For your privacy the message itself stays in your portal. This link is private to you; please don't forward it.",
      });
      notified = (await sendEmail({ orgId: ctx.orgId, firmId, to: d.a.email, subject: `New message about your application · ${d.matter.ref}`, template: "portal_message", ...mail })).status;
    }
  }
  return { message: d.m, notified };
}

/* ───────── Google Drive ───────── */

/** Try a failed or skipped Drive upload again (for example after the folder was shared). */
export async function retryDriveUpload(ctx: AccessContext, firmId: string, matterId: string, uploadId: string) {
  requireEdit(ctx, firmId);
  const d = await withScope(ctx.scopeFor(firmId), async (tx) => {
    const matter = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const [u] = await tx.select().from(portalUploads).where(and(eq(portalUploads.id, uploadId), eq(portalUploads.matterId, matter.id))).limit(1);
    if (!u) throw new NotFoundError("Upload");
    if (u.driveStatus === "uploaded") return { done: true as const };
    const [a] = await tx.select().from(portalAccess).where(and(eq(portalAccess.matterId, matter.id), isNull(portalAccess.revokedAt))).limit(1);
    if (!a?.driveFolderId) throw new ValidationError("Add the client's Google Drive folder first.");
    const [f] = await tx.select({ data: documentFiles.data, contentType: documentFiles.contentType }).from(documentFiles).where(eq(documentFiles.id, u.documentFileId));
    const [item] = u.checklistItemId ? await tx.select({ label: portalChecklistItems.label }).from(portalChecklistItems).where(eq(portalChecklistItems.id, u.checklistItemId)) : [];
    return { done: false as const, u, folderId: a.driveFolderId, f, label: item?.label ?? null };
  });
  if (d.done) return "uploaded";
  const up = await uploadToDrive({ folderId: d.folderId, name: driveFileName(d.u.filename, d.label, d.u.createdAt), contentType: d.f.contentType, data: d.f.data });
  await withScope(ctx.scopeFor(firmId), (tx) =>
    tx.update(portalUploads).set({ driveStatus: up.status, driveFileId: up.status === "uploaded" ? up.fileId : null, driveError: up.status === "failed" ? up.error.slice(0, 500) : null }).where(eq(portalUploads.id, uploadId)),
  );
  return up.status;
}
