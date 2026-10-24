import "server-only";
import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, exists, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Tx } from "../../db/client";
import {
  activities, clients, documentComments, documentFiles, documents, documentTemplates, documentTemplateVersions, documentVersions, firmBilling, firms, matterDates, matterFacts,
  matterPeople, matters, users, type DocContent,
} from "../../db/schema";
import { aiConfigured, draftText } from "../../integrations/anthropic";
import { extractText } from "../../integrations/ocr";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../errors";
import { optionalText, optionalUuid, parseOrThrow } from "../../validation";
import { loadVisibleClient } from "../clients/clients";
import { canViewMatters, loadVisibleMatter, matterVisibility } from "../matters/matters";
import { nextRef } from "../refs";
import { ContentError, contentFromText, EMPTY_DOC, fillMergeFields, gapsIn, longDate, MERGE_FIELDS, mergeFieldsIn, plainText, sanitizeContent, type MergeValues } from "./content";
import { renderDocumentPdf, type Letterhead } from "./render";

/**
 * The document workspace: drafting from branded templates, autosave and saved
 * versions, review and approval, final documents that are never overwritten,
 * uploaded files with OCR, and AI drafting assistance from authorised data.
 *
 * Status: draft → in review → (changes requested → draft …) → approved → final.
 * A document belongs to a practice and, optionally, a client and a matter; it
 * is visible to people who may see that matter (or client).
 */

export const KIND_LABEL = {
  letter: "Client letter",
  representation: "Representation",
  consultation_report: "Consultation report",
  roadmap: "Roadmap",
  engagement: "Engagement document",
  submission_pack: "Submission pack",
  precedent: "Precedent",
  other: "Other",
} as const;
export type DocumentKind = keyof typeof KIND_LABEL;
const KINDS = Object.keys(KIND_LABEL) as [DocumentKind, ...DocumentKind[]];

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const asContent = (raw: unknown) => {
  try {
    return sanitizeContent(raw);
  } catch (e) {
    if (e instanceof ContentError) throw new ValidationError(e.message);
    throw e;
  }
};

/* ───────── Access ───────── */

export function canViewDocuments(ctx: AccessContext, firmId: string) {
  return ctx.has("documents:view", firmId);
}

/** Documents this person may see: those on matters and clients they can see, and practice-level documents. */
function visibility(ctx: AccessContext, firmId: string): SQL[] {
  const branches: SQL[] = [and(isNull(documents.matterId), isNull(documents.clientId))!];
  if (canViewMatters(ctx, firmId)) {
    branches.push(and(isNotNull(documents.matterId), exists(sql`(select 1 from ${matters} where ${matters.id} = ${documents.matterId} and ${and(...matterVisibility(ctx, firmId))})`))!);
  }
  if (ctx.has("clients:view_all", firmId)) branches.push(and(isNull(documents.matterId), isNotNull(documents.clientId))!);
  else if (ctx.has("clients:view_assigned", firmId)) {
    branches.push(and(isNull(documents.matterId), exists(sql`(select 1 from ${clients} where ${clients.id} = ${documents.clientId} and ${clients.primaryConsultantId} = ${ctx.user.id})`))!);
  }
  return [eq(documents.firmId, firmId), or(...branches)!];
}

async function assertLinksVisible(tx: Tx, ctx: AccessContext, firmId: string, clientId: string | null, matterId: string | null): Promise<{ clientId: string | null; matterId: string | null }> {
  try {
    if (matterId) {
      const m = await loadVisibleMatter(tx, ctx, firmId, matterId);
      return { clientId: m.clientId, matterId: m.id };
    }
    if (clientId) await loadVisibleClient(tx, ctx, firmId, clientId);
    return { clientId, matterId: null };
  } catch (e) {
    if (e instanceof AccessDeniedError || e instanceof NotFoundError) throw new NotFoundError(matterId ? "Matter" : "Client");
    throw e;
  }
}

async function loadDocument(tx: Tx, ctx: AccessContext, firmId: string, id: string, lock = false) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Document");
  const q = tx.select().from(documents).where(and(eq(documents.id, id), ...visibility(ctx, firmId))).limit(1);
  const [doc] = lock ? await q.for("update") : await q;
  if (!doc) throw new NotFoundError("Document");
  return doc;
}

const editable = (status: string) => status === "draft" || status === "changes_requested";

/* ───────── Merge values and letterhead ───────── */

async function letterheadFor(tx: Tx, firmId: string): Promise<Letterhead> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId));
  const [b] = await tx.select({ address: firmBilling.address, registrationNumber: firmBilling.registrationNumber }).from(firmBilling).where(eq(firmBilling.firmId, firmId));
  return { tradingName: f.tradingName, legalName: f.legalName, slug: f.slug, brandColor: f.brandColor, contactEmail: f.contactEmail, contactPhone: f.contactPhone, website: f.website, address: b?.address ?? null, registrationNumber: b?.registrationNumber ?? null };
}

async function mergeValues(tx: Tx, ctx: AccessContext, firmId: string, link: { clientId: string | null; matterId: string | null }, ref: string): Promise<MergeValues> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId));
  const v: MergeValues = {
    "firm.tradingName": f.tradingName, "firm.legalName": f.legalName, "firm.contactEmail": f.contactEmail, "firm.contactPhone": f.contactPhone, "firm.website": f.website,
    "user.name": ctx.user.name, "user.email": ctx.user.email, "document.ref": ref, today: longDate(),
  };
  if (link.clientId) {
    const [c] = await tx.select().from(clients).where(and(eq(clients.id, link.clientId), eq(clients.firmId, firmId)));
    if (c) Object.assign(v, { "client.fullName": [c.firstName, c.lastName].filter(Boolean).join(" "), "client.firstName": c.firstName, "client.lastName": c.lastName, "client.ref": c.ref, "client.email": c.email, "client.phone": c.phone, "client.nationality": c.nationality, "client.countryOfResidence": c.countryOfResidence });
  }
  if (link.matterId) {
    const [m] = await tx.select().from(matters).where(and(eq(matters.id, link.matterId), eq(matters.firmId, firmId)));
    if (m) Object.assign(v, { "matter.ref": m.ref, "matter.title": m.title, "matter.legalCategory": m.legalCategory, "matter.jurisdiction": m.jurisdiction, "matter.submissionReference": m.submissionReference });
  }
  return v;
}

/* ───────── Templates ───────── */

export async function listTemplates(ctx: AccessContext, firmId: string, opts: { activeOnly?: boolean } = {}) {
  if (!ctx.has("documents:view", firmId) && !ctx.has("document_templates:manage", firmId)) throw new AccessDeniedError("documents:view");
  return withScope(ctx.scopeFor(firmId), (tx) =>
    tx
      .select({ id: documentTemplates.id, kind: documentTemplates.kind, name: documentTemplates.name, description: documentTemplates.description, isActive: documentTemplates.isActive, isStarter: documentTemplates.isStarter, version: documentTemplates.version, updatedAt: documentTemplates.updatedAt, letterhead: documentTemplates.letterhead })
      .from(documentTemplates)
      .where(and(eq(documentTemplates.firmId, firmId), opts.activeOnly ? eq(documentTemplates.isActive, true) : undefined))
      .orderBy(asc(documentTemplates.kind), asc(documentTemplates.name)),
  );
}

export async function getTemplate(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("document_templates:manage", firmId);
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Template");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [t] = await tx.select().from(documentTemplates).where(and(eq(documentTemplates.id, id), eq(documentTemplates.firmId, firmId)));
    if (!t) throw new NotFoundError("Template");
    const history = await tx
      .select({ version: documentTemplateVersions.version, name: documentTemplateVersions.name, editedAt: documentTemplateVersions.editedAt, editedBy: users.name })
      .from(documentTemplateVersions)
      .leftJoin(users, eq(users.id, documentTemplateVersions.editedById))
      .where(eq(documentTemplateVersions.templateId, t.id))
      .orderBy(desc(documentTemplateVersions.version));
    return { template: t, history };
  });
}

const templateSchema = z.object({
  name: z.string().trim().min(3, "Name the template.").max(120),
  kind: z.enum(KINDS),
  description: optionalText(300),
  letterhead: z.boolean().default(true),
});

/** Create or update a template. Every save is kept as a version; unknown merge fields are refused. */
export async function saveTemplate(ctx: AccessContext, firmId: string, id: string | null, raw: unknown, rawContent: unknown) {
  ctx.require("document_templates:manage", firmId);
  const input = parseOrThrow(templateSchema, raw);
  const content = asContent(rawContent);
  const { unknown } = mergeFieldsIn(content);
  if (unknown.length) throw new ValidationError(`Unknown merge field${unknown.length === 1 ? "" : "s"}: ${unknown.map((u) => `{{${u}}}`).join(", ")}. Choose from the list.`, { content: "Unknown merge fields." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [dupe] = await tx.select({ id: documentTemplates.id }).from(documentTemplates).where(and(eq(documentTemplates.firmId, firmId), eq(documentTemplates.name, input.name), id ? ne(documentTemplates.id, id) : undefined));
    if (dupe) throw new ValidationError("Another template has that name.", { name: "Already used." });
    let t;
    if (id) {
      const [cur] = await tx.select().from(documentTemplates).where(and(eq(documentTemplates.id, id), eq(documentTemplates.firmId, firmId))).for("update");
      if (!cur) throw new NotFoundError("Template");
      [t] = await tx
        .update(documentTemplates)
        .set({ ...input, description: input.description ?? null, content, version: cur.version + 1, isStarter: false, updatedById: ctx.user.id, updatedAt: new Date() })
        .where(eq(documentTemplates.id, id))
        .returning();
    } else {
      [t] = await tx.insert(documentTemplates).values({ firmId, ...input, description: input.description ?? null, content, createdById: ctx.user.id, updatedById: ctx.user.id }).returning();
    }
    await tx.insert(documentTemplateVersions).values({ firmId, templateId: t.id, version: t.version, name: t.name, content, editedById: ctx.user.id });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: id ? "document_template.updated" : "document_template.created", entityType: "document_template", entityId: t.id, summary: `${id ? "Updated" : "Created"} document template “${t.name}” (v${t.version})`, ip: ctx.ip }, tx);
    return t;
  });
}

export async function setTemplateActive(ctx: AccessContext, firmId: string, id: string, active: boolean) {
  ctx.require("document_templates:manage", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [t] = await tx.update(documentTemplates).set({ isActive: active, updatedAt: new Date(), updatedById: ctx.user.id }).where(and(eq(documentTemplates.id, id), eq(documentTemplates.firmId, firmId))).returning();
    if (!t) throw new NotFoundError("Template");
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "document_template.updated", entityType: "document_template", entityId: t.id, summary: `${active ? "Switched on" : "Switched off"} template “${t.name}”`, ip: ctx.ip }, tx);
    return t;
  });
}

/* ───────── Documents ───────── */

export type DocumentFilters = { status?: string; kind?: string; q?: string; matterId?: string; clientId?: string; mine?: boolean; page?: number };

export async function listDocuments(ctx: AccessContext, firmId: string, f: DocumentFilters = {}) {
  ctx.require("documents:view", firmId);
  const conds = visibility(ctx, firmId);
  if (f.status === "review") conds.push(eq(documents.status, "in_review"));
  else if (f.status === "open") conds.push(inArray(documents.status, ["draft", "in_review", "changes_requested", "approved"]));
  else if (f.status && ["draft", "in_review", "changes_requested", "approved", "final"].includes(f.status)) conds.push(eq(documents.status, f.status as "draft"));
  if (f.kind && f.kind in KIND_LABEL) conds.push(eq(documents.kind, f.kind as DocumentKind));
  if (f.matterId && z.string().uuid().safeParse(f.matterId).success) conds.push(eq(documents.matterId, f.matterId));
  if (f.clientId && z.string().uuid().safeParse(f.clientId).success) conds.push(eq(documents.clientId, f.clientId));
  if (f.mine) conds.push(or(eq(documents.createdById, ctx.user.id), eq(documents.reviewerId, ctx.user.id))!);
  if (f.q?.trim()) {
    const term = `%${f.q.trim().slice(0, 80).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(documents.title, term), ilike(documents.ref, term))!);
  }
  const page = Math.max(1, Math.floor(f.page ?? 1));
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const rows = await tx
      .select({
        id: documents.id, ref: documents.ref, title: documents.title, kind: documents.kind, status: documents.status, version: documents.version, aiAssisted: documents.aiAssisted,
        updatedAt: documents.updatedAt, clientId: documents.clientId, matterId: documents.matterId, clientRef: clients.ref, matterRef: matters.ref, author: users.name,
        reviewerId: documents.reviewerId,
      })
      .from(documents)
      .leftJoin(clients, eq(clients.id, documents.clientId))
      .leftJoin(matters, eq(matters.id, documents.matterId))
      .leftJoin(users, eq(users.id, documents.createdById))
      .where(and(...conds))
      .orderBy(desc(documents.updatedAt))
      .limit(50)
      .offset((page - 1) * 50);
    const [{ total }] = await tx.select({ total: count() }).from(documents).where(and(...conds));
    return { rows, total: Number(total), page, pageSize: 50 };
  });
}

export async function getDocument(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("documents:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id);
    const versions = await tx
      .select({ version: documentVersions.version, title: documentVersions.title, note: documentVersions.note, isFinal: documentVersions.isFinal, createdAt: documentVersions.createdAt, author: users.name })
      .from(documentVersions)
      .leftJoin(users, eq(users.id, documentVersions.createdById))
      .where(eq(documentVersions.documentId, doc.id))
      .orderBy(desc(documentVersions.version));
    const comments = await tx
      .select({ c: documentComments, author: users.name })
      .from(documentComments)
      .leftJoin(users, eq(users.id, documentComments.authorId))
      .where(eq(documentComments.documentId, doc.id))
      .orderBy(asc(documentComments.createdAt));
    const client = doc.clientId ? ((await tx.select({ id: clients.id, ref: clients.ref, firstName: clients.firstName, lastName: clients.lastName }).from(clients).where(eq(clients.id, doc.clientId)))[0] ?? null) : null;
    const matter = doc.matterId ? ((await tx.select({ id: matters.id, ref: matters.ref, title: matters.title }).from(matters).where(eq(matters.id, doc.matterId)))[0] ?? null) : null;
    const files = await tx
      .select({ id: documentFiles.id, filename: documentFiles.filename, size: documentFiles.size, ocrStatus: documentFiles.ocrStatus, createdAt: documentFiles.createdAt })
      .from(documentFiles)
      .where(eq(documentFiles.documentId, doc.id))
      .orderBy(desc(documentFiles.createdAt));
    const names = await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [doc.createdById, doc.reviewerId, doc.approvedById, doc.finalisedById, doc.contentUpdatedById].filter((x): x is string => !!x)));
    const nameOf = (uid: string | null) => names.find((n) => n.id === uid)?.name ?? null;
    const team = await tx.execute<{ id: string; name: string }>(sql`select u.id, u.name from firm_memberships m join users u on u.id = m.user_id join roles r on r.id = m.role_id
      where m.firm_id = ${firmId} and m.status = 'active' and u.status = 'active' and ('documents:approve' = any(r.permissions)) order by u.name`);
    return {
      document: doc,
      people: { author: nameOf(doc.createdById), reviewer: nameOf(doc.reviewerId), approvedBy: nameOf(doc.approvedById), finalisedBy: nameOf(doc.finalisedById), lastEditedBy: nameOf(doc.contentUpdatedById) },
      versions,
      comments: comments.map((r) => ({ ...r.c, author: r.author })),
      client, matter, files,
      gaps: gapsIn(doc.content),
      reviewers: team.rows.filter((u) => u.id !== ctx.user.id),
      aiAvailable: aiConfigured(),
    };
  });
}

/** Options for a new document: templates, and the clients and matters this person can see. */
export async function documentFormOptions(ctx: AccessContext, firmId: string) {
  ctx.require("documents:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const templates = await tx.select({ id: documentTemplates.id, name: documentTemplates.name, kind: documentTemplates.kind, isStarter: documentTemplates.isStarter }).from(documentTemplates).where(and(eq(documentTemplates.firmId, firmId), eq(documentTemplates.isActive, true))).orderBy(asc(documentTemplates.name));
    const cl = ctx.has("clients:view_all", firmId) || ctx.has("clients:view_assigned", firmId)
      ? await tx.select({ id: clients.id, ref: clients.ref, firstName: clients.firstName, lastName: clients.lastName }).from(clients).where(and(eq(clients.firmId, firmId), isNull(clients.deletedAt), ctx.has("clients:view_all", firmId) ? undefined : eq(clients.primaryConsultantId, ctx.user.id))).orderBy(asc(clients.firstName)).limit(1000)
      : [];
    const ms = canViewMatters(ctx, firmId) ? await tx.select({ id: matters.id, ref: matters.ref, title: matters.title, clientId: matters.clientId }).from(matters).where(and(...matterVisibility(ctx, firmId))).orderBy(desc(matters.openedAt)).limit(1000) : [];
    return { templates, clients: cl, matters: ms };
  });
}

const createSchema = z.object({
  title: z.string().trim().min(3, "Give the document a title.").max(200),
  kind: z.enum(KINDS),
  templateId: optionalUuid,
  clientId: optionalUuid,
  matterId: optionalUuid,
});

/** Start a document, from a template (merge fields filled from the linked client and matter) or blank. */
export async function createDocument(ctx: AccessContext, firmId: string, raw: unknown) {
  ctx.require("documents:edit", firmId);
  const input = parseOrThrow(createSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const link = await assertLinksVisible(tx, ctx, firmId, input.clientId ?? null, input.matterId ?? null);
    let content: DocContent = EMPTY_DOC;
    let template: typeof documentTemplates.$inferSelect | undefined;
    if (input.templateId) {
      [template] = await tx.select().from(documentTemplates).where(and(eq(documentTemplates.id, input.templateId), eq(documentTemplates.firmId, firmId), eq(documentTemplates.isActive, true)));
      if (!template) throw new ValidationError("Choose an active template.", { templateId: "Not available." });
      content = template.content;
    }
    const ref = await nextRef(tx, firmId, ctx.firm(firmId).refPrefix, "document");
    const filled = fillMergeFields(content, await mergeValues(tx, ctx, firmId, link, ref));
    const [doc] = await tx
      .insert(documents)
      .values({
        firmId, ref, title: input.title, kind: input.kind, clientId: link.clientId, matterId: link.matterId, templateId: template?.id ?? null, templateVersion: template?.version ?? null,
        letterhead: template?.letterhead ?? true, content: filled.content, contentUpdatedById: ctx.user.id, createdById: ctx.user.id,
      })
      .returning();
    if (link.clientId) await tx.insert(activities).values({ firmId, clientId: link.clientId, matterId: link.matterId, type: "updated", body: `Document ${ref} started: ${input.title}`, data: { documentId: doc.id }, actorId: ctx.user.id });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "document.created", entityType: "document", entityId: doc.id, summary: `Started ${ref} “${input.title}”${template ? ` from “${template.name}”` : ""}`, ip: ctx.ip }, tx);
    return { document: doc, missing: filled.missing };
  });
}

/** Autosave the working copy. Refuses if someone else saved since the editor loaded it. */
export async function autosaveDocument(ctx: AccessContext, firmId: string, id: string, raw: { title?: unknown; content: unknown; baseUpdatedAt?: unknown }) {
  ctx.require("documents:edit", firmId);
  const content = asContent(raw.content);
  const title = raw.title === undefined ? undefined : parseOrThrow(z.string().trim().min(3, "Give the document a title.").max(200), raw.title);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id, true);
    if (!editable(doc.status)) throw new ConflictError(doc.status === "final" ? "This document is final and can't be changed. Start a new version from it." : "This document is with review. Edit it again once it's back, or reopen it.");
    const base = typeof raw.baseUpdatedAt === "string" ? new Date(raw.baseUpdatedAt) : null;
    if (base && Math.abs(doc.contentUpdatedAt.getTime() - base.getTime()) > 1 && doc.contentUpdatedById !== ctx.user.id) {
      throw new ConflictError("Someone else changed this document while you were editing. Copy your changes, then reload to see theirs.");
    }
    const now = new Date();
    await tx.update(documents).set({ content, ...(title ? { title } : {}), contentUpdatedAt: now, contentUpdatedById: ctx.user.id, updatedAt: now }).where(eq(documents.id, doc.id));
    return { savedAt: now.toISOString(), gaps: gapsIn(content) };
  });
}

async function snapshot(tx: Tx, ctx: AccessContext, doc: typeof documents.$inferSelect, note: string | null, extra: { isFinal?: boolean; pdf?: Buffer } = {}) {
  const version = doc.version + 1;
  await tx.insert(documentVersions).values({
    firmId: doc.firmId, documentId: doc.id, matterId: doc.matterId, version, title: doc.title, content: doc.content, note, isFinal: !!extra.isFinal,
    pdf: extra.pdf ?? null, pdfSha256: extra.pdf ? createHash("sha256").update(extra.pdf).digest("hex") : null, createdById: ctx.user.id,
  });
  await tx.update(documents).set({ version, updatedAt: new Date() }).where(eq(documents.id, doc.id));
  return version;
}

/** Keep the current working copy as a numbered version. */
export async function saveVersion(ctx: AccessContext, firmId: string, id: string, note?: string) {
  ctx.require("documents:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id, true);
    if (doc.status === "final") throw new ConflictError("A final document already has its final version.");
    const [last] = await tx.select({ content: documentVersions.content, title: documentVersions.title }).from(documentVersions).where(eq(documentVersions.documentId, doc.id)).orderBy(desc(documentVersions.version)).limit(1);
    if (last && last.title === doc.title && JSON.stringify(last.content) === JSON.stringify(doc.content)) throw new ConflictError("No changes since the last saved version.");
    const version = await snapshot(tx, ctx, doc, note?.trim().slice(0, 300) || null);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "document.version_saved", entityType: "document", entityId: doc.id, summary: `Saved ${doc.ref} v${version}`, ip: ctx.ip }, tx);
    return version;
  });
}

/** Restore an earlier version into the working copy (the history is kept). */
export async function restoreVersion(ctx: AccessContext, firmId: string, id: string, version: number) {
  ctx.require("documents:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id, true);
    if (!editable(doc.status)) throw new ConflictError("Only a draft can be changed.");
    const [v] = await tx.select().from(documentVersions).where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.version, version)));
    if (!v) throw new NotFoundError("Version");
    const now = new Date();
    await tx.update(documents).set({ content: v.content, title: v.title, contentUpdatedAt: now, contentUpdatedById: ctx.user.id, updatedAt: now }).where(eq(documents.id, doc.id));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "document.restored", entityType: "document", entityId: doc.id, summary: `Restored ${doc.ref} to v${version}`, ip: ctx.ip }, tx);
  });
}

export async function updateDocumentDetails(ctx: AccessContext, firmId: string, id: string, raw: unknown) {
  ctx.require("documents:edit", firmId);
  const input = parseOrThrow(z.object({ kind: z.enum(KINDS), letterhead: z.boolean() }), raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id, true);
    if (doc.status === "final") throw new ConflictError("A final document can't be changed.");
    await tx.update(documents).set({ kind: input.kind, letterhead: input.letterhead, updatedAt: new Date() }).where(eq(documents.id, doc.id));
  });
}

async function comment(tx: Tx, ctx: AccessContext, doc: typeof documents.$inferSelect, kind: "comment" | "changes_requested" | "approved", body: string, version: number | null) {
  await tx.insert(documentComments).values({ firmId: doc.firmId, documentId: doc.id, matterId: doc.matterId, version, kind, body, authorId: ctx.user.id });
}

/** Send for review: keeps the version under review and names the reviewer. */
export async function submitForReview(ctx: AccessContext, firmId: string, id: string, reviewerId: string | null, note?: string) {
  ctx.require("documents:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id, true);
    if (!editable(doc.status)) throw new ConflictError("Only a draft can be sent for review.");
    if (!plainText(doc.content)) throw new ValidationError("The document is empty.");
    if (reviewerId) {
      if (reviewerId === ctx.user.id) throw new ValidationError("Choose someone else to review it.", { reviewerId: "Choose someone else." });
      const ok = await tx.execute(sql`select 1 from firm_memberships m join roles r on r.id = m.role_id join users u on u.id = m.user_id
        where m.firm_id = ${firmId} and m.user_id = ${reviewerId} and m.status = 'active' and u.status = 'active' and 'documents:approve' = any(r.permissions)`);
      if (!ok.rows.length) throw new ValidationError("Choose a reviewer from this practice.", { reviewerId: "Not a reviewer here." });
    }
    const version = await snapshot(tx, ctx, doc, note?.trim().slice(0, 300) || "Sent for review");
    await tx.update(documents).set({ status: "in_review", reviewerId, approvedById: null, approvedAt: null, updatedAt: new Date() }).where(eq(documents.id, doc.id));
    await comment(tx, ctx, doc, "comment", note?.trim() ? `Sent for review: ${note.trim().slice(0, 1000)}` : "Sent for review.", version);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "document.submitted", entityType: "document", entityId: doc.id, summary: `Sent ${doc.ref} v${version} for review`, ip: ctx.ip }, tx);
    return version;
  });
}

function requireReviewer(ctx: AccessContext, firmId: string, doc: typeof documents.$inferSelect, lastEditorId: string | null) {
  ctx.require("documents:approve", firmId);
  // Professional review: someone other than the person who wrote the version, unless they run the practice.
  if ((lastEditorId === ctx.user.id || doc.contentUpdatedById === ctx.user.id) && !ctx.has("firm:manage", firmId)) throw new AccessDeniedError("documents:approve (second person)");
}

export async function requestChanges(ctx: AccessContext, firmId: string, id: string, body: string) {
  if (body.trim().length < 3) throw new ValidationError("Say what needs to change.", { body: "Required." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id, true);
    if (doc.status !== "in_review") throw new ConflictError("This document isn't in review.");
    const [last] = await tx.select({ by: documentVersions.createdById }).from(documentVersions).where(eq(documentVersions.documentId, doc.id)).orderBy(desc(documentVersions.version)).limit(1);
    requireReviewer(ctx, firmId, doc, last?.by ?? null);
    await tx.update(documents).set({ status: "changes_requested", updatedAt: new Date() }).where(eq(documents.id, doc.id));
    await comment(tx, ctx, doc, "changes_requested", body.trim().slice(0, 4000), doc.version);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "document.changes_requested", entityType: "document", entityId: doc.id, summary: `Asked for changes to ${doc.ref} v${doc.version}`, ip: ctx.ip }, tx);
  });
}

export async function approveDocument(ctx: AccessContext, firmId: string, id: string, note?: string) {
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id, true);
    if (doc.status !== "in_review") throw new ConflictError("This document isn't in review.");
    const [last] = await tx.select({ by: documentVersions.createdById }).from(documentVersions).where(eq(documentVersions.documentId, doc.id)).orderBy(desc(documentVersions.version)).limit(1);
    requireReviewer(ctx, firmId, doc, last?.by ?? null);
    const gaps = gapsIn(doc.content);
    if (gaps.prompts.length || gaps.fields.length) throw new ValidationError(`It still has ${gaps.prompts.length + gaps.fields.length} gap${gaps.prompts.length + gaps.fields.length === 1 ? "" : "s"} to complete. Ask for changes instead.`);
    await tx.update(documents).set({ status: "approved", approvedById: ctx.user.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, doc.id));
    await comment(tx, ctx, doc, "approved", note?.trim() ? note.trim().slice(0, 4000) : `Approved v${doc.version}.`, doc.version);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "document.approved", entityType: "document", entityId: doc.id, summary: `Approved ${doc.ref} v${doc.version}${doc.aiAssisted ? " (AI-assisted draft)" : ""}`, ip: ctx.ip }, tx);
  });
}

/** Take a document back from review or approval to edit it (approval is cleared). */
export async function reopenDocument(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("documents:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id, true);
    if (doc.status !== "in_review" && doc.status !== "approved") throw new ConflictError("Only a document in review or approved can be reopened.");
    await tx.update(documents).set({ status: "draft", approvedById: null, approvedAt: null, updatedAt: new Date() }).where(eq(documents.id, doc.id));
    await comment(tx, ctx, doc, "comment", doc.status === "approved" ? "Reopened for editing; the approval no longer applies." : "Taken back from review for editing.", doc.version);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "document.reopened", entityType: "document", entityId: doc.id, summary: `Reopened ${doc.ref}`, ip: ctx.ip }, tx);
  });
}

/** Make an approved document final: its PDF is generated once and kept; nothing about it can change afterwards. */
export async function finaliseDocument(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("documents:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id, true);
    if (doc.status !== "approved") throw new ConflictError("Only an approved document can be made final.");
    const gaps = gapsIn(doc.content);
    if (gaps.prompts.length || gaps.fields.length) throw new ValidationError("Complete the remaining gaps first.");
    const version = doc.version + 1;
    const pdf = await renderDocumentPdf({ title: doc.title, ref: doc.ref, version, final: true, letterhead: doc.letterhead ? await letterheadFor(tx, firmId) : null, content: doc.content });
    await snapshot(tx, ctx, doc, "Final", { isFinal: true, pdf });
    const now = new Date();
    await tx.update(documents).set({ status: "final", finalVersion: version, finalisedById: ctx.user.id, finalisedAt: now, updatedAt: now }).where(eq(documents.id, doc.id));
    if (doc.clientId) await tx.insert(activities).values({ firmId, clientId: doc.clientId, matterId: doc.matterId, type: "updated", body: `Document ${doc.ref} made final: ${doc.title}`, data: { documentId: doc.id }, actorId: ctx.user.id });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "document.finalised", entityType: "document", entityId: doc.id, summary: `Made ${doc.ref} final (v${version})`, ip: ctx.ip }, tx);
    return version;
  });
}

/** Start a new draft from an existing document (the way to revise a final one). */
export async function duplicateDocument(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("documents:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const src = await loadDocument(tx, ctx, firmId, id);
    const ref = await nextRef(tx, firmId, ctx.firm(firmId).refPrefix, "document");
    const [doc] = await tx
      .insert(documents)
      .values({ firmId, ref, title: src.title, kind: src.kind, clientId: src.clientId, matterId: src.matterId, templateId: src.templateId, templateVersion: src.templateVersion, letterhead: src.letterhead, content: src.content, contentUpdatedById: ctx.user.id, createdById: ctx.user.id })
      .returning();
    await comment(tx, ctx, doc, "comment", `Started from ${src.ref}${src.finalVersion ? ` (final v${src.finalVersion})` : ""}.`, null);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "document.created", entityType: "document", entityId: doc.id, summary: `Started ${ref} from ${src.ref}`, ip: ctx.ip }, tx);
    return doc;
  });
}

export async function addComment(ctx: AccessContext, firmId: string, id: string, body: string) {
  ctx.require("documents:view", firmId);
  if (!ctx.has("documents:edit", firmId) && !ctx.has("documents:approve", firmId)) throw new AccessDeniedError("documents:edit");
  if (body.trim().length < 1) throw new ValidationError("Write a comment.", { body: "Required." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id);
    await comment(tx, ctx, doc, "comment", body.trim().slice(0, 4000), doc.version || null);
  });
}

export async function resolveComment(ctx: AccessContext, firmId: string, id: string, commentId: string) {
  ctx.require("documents:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id);
    const [c] = await tx.update(documentComments).set({ resolvedAt: new Date(), resolvedById: ctx.user.id }).where(and(eq(documentComments.id, commentId), eq(documentComments.documentId, doc.id), isNull(documentComments.resolvedAt))).returning();
    if (!c) throw new NotFoundError("Comment");
  });
}

/* ───────── Export ───────── */

/** Content for export: the final version for final documents (stored PDF as-is), otherwise a version or the working copy, marked draft. */
export async function exportSource(ctx: AccessContext, firmId: string, id: string, version?: number) {
  ctx.require("documents:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id);
    const letterhead = doc.letterhead ? await letterheadFor(tx, firmId) : null;
    const wanted = version ?? (doc.status === "final" ? doc.finalVersion! : undefined);
    if (wanted) {
      const [v] = await tx.select().from(documentVersions).where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.version, wanted)));
      if (!v) throw new NotFoundError("Version");
      return { doc, input: { title: v.title, ref: doc.ref, version: v.version, final: v.isFinal, letterhead, content: v.content }, storedPdf: v.isFinal ? v.pdf : null };
    }
    return { doc, input: { title: doc.title, ref: doc.ref, version: null, final: false, letterhead, content: doc.content }, storedPdf: null };
  });
}

/* ───────── AI drafting ───────── */

const BASIS_LABEL = { verified: "VERIFIED (evidence on file)", client_statement: "CLIENT STATEMENT (not verified)", staff_assessment: "STAFF ASSESSMENT" } as const;

/**
 * Ask the drafting model for a draft using only the records this person may
 * see on the linked client and matter. Missing facts come back as [[GAP: …]]
 * markers. The current working copy is saved as a version first, and the
 * document is marked AI-assisted; it still goes through review.
 */
export async function draftWithAi(ctx: AccessContext, firmId: string, id: string, instructionsRaw: string) {
  ctx.require("documents:edit", firmId);
  if (!aiConfigured()) throw new ValidationError("AI drafting isn't switched on for this workspace.");
  const instructions = instructionsRaw.trim();
  if (instructions.length < 10) throw new ValidationError("Say what the draft should cover.", { instructions: "At least a sentence." });
  const material = await withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id);
    if (!editable(doc.status)) throw new ConflictError("Only a draft can be redrafted.");
    const lines: string[] = [`Practice: ${ctx.firm(firmId).tradingName}`, `Document type: ${KIND_LABEL[doc.kind]}`, `Title: ${doc.title}`];
    const sources: string[] = [];
    if (doc.clientId) {
      const [c] = await tx.select().from(clients).where(eq(clients.id, doc.clientId));
      if (c) {
        lines.push(`Client: ${[c.firstName, c.lastName].filter(Boolean).join(" ")} (${c.ref}); nationality: ${c.nationality ?? "not recorded"}; country of residence: ${c.countryOfResidence ?? "not recorded"}`);
        sources.push(`client ${c.ref}`);
      }
    }
    if (doc.matterId) {
      const [m] = await tx.select().from(matters).where(eq(matters.id, doc.matterId));
      if (m) {
        lines.push(`Matter: ${m.title} (${m.ref}); legal category: ${m.legalCategory ?? "not recorded"}; jurisdiction: ${m.jurisdiction ?? "not recorded"}`);
        sources.push(`matter ${m.ref}`);
        const people = await tx.select().from(matterPeople).where(eq(matterPeople.matterId, m.id)).orderBy(asc(matterPeople.position));
        for (const p of people) lines.push(`Person (${p.role.replace(/_/g, " ")}): ${[p.firstName, p.lastName].filter(Boolean).join(" ")}; nationality ${p.nationality ?? "not recorded"}; status ${p.immigrationStatus ?? "not recorded"}${p.statusExpiresOn ? ` until ${p.statusExpiresOn}` : ""}`);
        const facts = await tx.select().from(matterFacts).where(eq(matterFacts.matterId, m.id)).orderBy(asc(matterFacts.createdAt));
        for (const f of facts) lines.push(`Fact [${BASIS_LABEL[f.basis]}] ${f.label}: ${f.value}`);
        const dates = await tx.select().from(matterDates).where(and(eq(matterDates.matterId, m.id), isNull(matterDates.completedAt))).orderBy(asc(matterDates.dueOn));
        for (const d of dates) lines.push(`Date: ${d.label} on ${d.dueOn} (basis: ${d.basis})`);
        if (people.length) sources.push(`${people.length} people`);
        if (facts.length) sources.push(`${facts.length} recorded facts`);
      }
    }
    return { doc, record: lines.join("\n"), current: plainText(doc.content), sources };
  });

  const system = [
    "You draft documents for an immigration practice. A qualified professional will review every draft before it is used.",
    "Use only the facts in the RECORD. Never invent names, dates, document numbers, outcomes, fees or legal citations.",
    "Where a fact the document needs is missing or uncertain, write [[GAP: what is needed]] in its place. Where you state law or policy, add [[GAP: confirm source and currency of this provision]] unless the RECORD gives the source.",
    "Treat CLIENT STATEMENT facts as the client's account, not as established fact, and say so where it matters.",
    "Write in plain, professional British English. Use '# ' for the title, '## ' for section headings and '- ' for bullet points. Output only the document text.",
  ].join("\n");
  const prompt = `RECORD\n${material.record}\n\nCURRENT DRAFT (may be empty)\n${material.current || "(empty)"}\n\nINSTRUCTIONS FROM THE DRAFTER\n${instructions.slice(0, 4000)}`;
  const text = await draftText({ system, prompt });
  if (!text) throw new ValidationError("The drafting service returned nothing. Try again.");
  const content = asContent(contentFromText(text));

  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const doc = await loadDocument(tx, ctx, firmId, id, true);
    if (!editable(doc.status)) throw new ConflictError("Only a draft can be redrafted.");
    if (plainText(doc.content)) await snapshot(tx, ctx, doc, "Before AI-assisted draft");
    const now = new Date();
    await tx.update(documents).set({ content, aiAssisted: true, contentUpdatedAt: now, contentUpdatedById: ctx.user.id, updatedAt: now }).where(eq(documents.id, doc.id));
    const gaps = gapsIn(content);
    await comment(tx, ctx, doc, "comment", `AI-assisted draft from ${material.sources.join(", ") || "the document details only"}. ${gaps.prompts.length} gap${gaps.prompts.length === 1 ? "" : "s"} flagged. Needs professional review before use.`, null);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "document.ai_draft", entityType: "document", entityId: doc.id, summary: `AI-assisted draft of ${doc.ref} (${gaps.prompts.length} gaps flagged)`, data: { sources: material.sources }, ip: ctx.ip }, tx);
    return { gaps };
  });
}

/* ───────── Uploaded files ───────── */

const uploadSchema = z.object({ clientId: optionalUuid, matterId: optionalUuid, documentId: optionalUuid, description: optionalText(300) });

/** Store an uploaded file unchanged, then read its text (OCR for images, text layer for PDFs). */
export async function uploadFile(ctx: AccessContext, firmId: string, raw: unknown, file: { name: string; type: string; data: Buffer }) {
  ctx.require("documents:edit", firmId);
  const input = parseOrThrow(uploadSchema, raw);
  if (!file.data.length) throw new ValidationError("Choose a file.", { file: "Required." });
  if (file.data.length > MAX_UPLOAD_BYTES) throw new ValidationError("Files can be up to 4 MB.", { file: "Too large." });
  const name = file.name.replace(/[\\/\0]/g, "_").slice(0, 200) || "upload";
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type.toLowerCase() : "application/octet-stream";
  const stored = await withScope(ctx.scopeFor(firmId), async (tx) => {
    let link = await assertLinksVisible(tx, ctx, firmId, input.clientId ?? null, input.matterId ?? null);
    if (input.documentId) {
      const d = await loadDocument(tx, ctx, firmId, input.documentId);
      link = { clientId: d.clientId, matterId: d.matterId };
    }
    if (!link.clientId && !link.matterId && !input.documentId) throw new ValidationError("Attach the file to a client, matter or document.");
    const [f] = await tx
      .insert(documentFiles)
      .values({ firmId, clientId: link.clientId, matterId: link.matterId, documentId: input.documentId ?? null, filename: name, contentType: type, size: file.data.length, sha256: createHash("sha256").update(file.data).digest("hex"), data: file.data, description: input.description ?? null, uploadedById: ctx.user.id })
      .returning({ id: documentFiles.id, matterId: documentFiles.matterId, clientId: documentFiles.clientId });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "document_file.uploaded", entityType: "document_file", entityId: f.id, summary: `Uploaded ${name} (${Math.ceil(file.data.length / 1024)} KB)`, ip: ctx.ip }, tx);
    return f;
  });
  await runOcr(ctx, firmId, stored.id, file.data, type);
  return stored;
}

async function runOcr(ctx: AccessContext, firmId: string, fileId: string, data: Buffer, type: string) {
  const r = await extractText(data, type);
  await withScope(ctx.scopeFor(firmId), (tx) =>
    tx
      .update(documentFiles)
      .set(r.status === "done" ? { ocrStatus: "done", ocrText: r.text, ocrEngine: r.engine, ocrConfidence: r.confidence, ocrError: null, ocrAt: new Date() } : { ocrStatus: r.status, ocrError: r.reason, ocrAt: new Date() })
      .where(and(eq(documentFiles.id, fileId), eq(documentFiles.firmId, firmId))),
  );
  return r;
}

export async function rerunOcr(ctx: AccessContext, firmId: string, fileId: string) {
  ctx.require("documents:edit", firmId);
  const f = await getFile(ctx, firmId, fileId);
  return runOcr(ctx, firmId, f.id, f.data, f.contentType);
}

export async function listFiles(ctx: AccessContext, firmId: string, f: { matterId?: string; clientId?: string }) {
  ctx.require("documents:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    await assertLinksVisible(tx, ctx, firmId, f.clientId ?? null, f.matterId ?? null);
    return tx
      .select({ id: documentFiles.id, filename: documentFiles.filename, contentType: documentFiles.contentType, size: documentFiles.size, description: documentFiles.description, ocrStatus: documentFiles.ocrStatus, ocrEngine: documentFiles.ocrEngine, ocrConfidence: documentFiles.ocrConfidence, ocrText: sql<string | null>`left(${documentFiles.ocrText}, 20000)`, createdAt: documentFiles.createdAt, uploadedBy: users.name, matterId: documentFiles.matterId })
      .from(documentFiles)
      .leftJoin(users, eq(users.id, documentFiles.uploadedById))
      .where(and(eq(documentFiles.firmId, firmId), f.matterId ? eq(documentFiles.matterId, f.matterId) : f.clientId ? eq(documentFiles.clientId, f.clientId) : undefined))
      .orderBy(desc(documentFiles.createdAt))
      .limit(200);
  });
}

export async function getFile(ctx: AccessContext, firmId: string, fileId: string) {
  ctx.require("documents:view", firmId);
  if (!z.string().uuid().safeParse(fileId).success) throw new NotFoundError("File");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [f] = await tx.select().from(documentFiles).where(and(eq(documentFiles.id, fileId), eq(documentFiles.firmId, firmId)));
    if (!f) throw new NotFoundError("File");
    if (f.documentId) await loadDocument(tx, ctx, firmId, f.documentId);
    else await assertLinksVisible(tx, ctx, firmId, f.clientId, f.matterId);
    return f;
  });
}

export { MERGE_FIELDS };
