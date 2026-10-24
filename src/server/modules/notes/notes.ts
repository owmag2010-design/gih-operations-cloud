import "server-only";
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Tx } from "../../db/client";
import { clients, leads, matters, noteRevisions, notes, users } from "../../db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../errors";
import { parseOrThrow } from "../../validation";

/**
 * Notes on a matter, client or lead. Each note is internal (staff only) or
 * client-visible (eligible for the client portal when it arrives). Every edit
 * keeps the previous text as a revision; deleting hides the note but keeps
 * its history.
 */

export type NoteSubject = { matterId: string } | { clientId: string } | { leadId: string };

const noteSchema = z.object({
  body: z.string().trim().min(1, "Write the note.").max(10_000, "Keep notes under 10,000 characters."),
  visibility: z.enum(["internal", "client_visible"]).default("internal"),
});

async function checkSubject(tx: Tx, ctx: AccessContext, firmId: string, s: NoteSubject, write: boolean) {
  if ("matterId" in s) {
    const { loadVisibleMatter } = await import("../matters/matters");
    if (write && !ctx.has("matters:edit", firmId)) throw new AccessDeniedError("matters:edit");
    return loadVisibleMatter(tx, ctx, firmId, s.matterId);
  }
  if ("clientId" in s) {
    const { loadVisibleClient } = await import("../clients/clients");
    if (write && !ctx.has("clients:edit", firmId)) throw new AccessDeniedError("clients:edit");
    return loadVisibleClient(tx, ctx, firmId, s.clientId);
  }
  if (!(ctx.has("leads:view_all", firmId) || ctx.has("leads:view_assigned", firmId))) throw new AccessDeniedError("leads:view");
  if (write && !ctx.has("leads:edit", firmId)) throw new AccessDeniedError("leads:edit");
  const [l] = await tx.select().from(leads).where(and(eq(leads.id, s.leadId), eq(leads.firmId, firmId), isNull(leads.deletedAt), ctx.has("leads:view_all", firmId) ? undefined : eq(leads.assignedToId, ctx.user.id)));
  if (!l) throw new NotFoundError("Lead");
  return l;
}

function subjectCond(s: NoteSubject): SQL {
  if ("matterId" in s) return eq(notes.matterId, s.matterId);
  if ("clientId" in s) return eq(notes.clientId, s.clientId);
  return eq(notes.leadId, s.leadId);
}

export async function listNotes(ctx: AccessContext, firmId: string, s: NoteSubject) {
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    await checkSubject(tx, ctx, firmId, s, false);
    const rows = await tx
      .select({ n: notes, author: users.name, editor: sql<string | null>`(select name from users u where u.id = ${notes.updatedById})` })
      .from(notes)
      .leftJoin(users, eq(users.id, notes.authorId))
      .where(and(eq(notes.firmId, firmId), subjectCond(s), isNull(notes.deletedAt)))
      .orderBy(desc(notes.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r.n, author: r.author, editor: r.editor }));
  });
}

export async function addNote(ctx: AccessContext, firmId: string, s: NoteSubject, raw: unknown) {
  const input = parseOrThrow(noteSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    await checkSubject(tx, ctx, firmId, s, true);
    const [note] = await tx
      .insert(notes)
      .values({ firmId, ...("matterId" in s ? { matterId: s.matterId } : "clientId" in s ? { clientId: s.clientId } : { leadId: s.leadId }), body: input.body, visibility: input.visibility, authorId: ctx.user.id, updatedById: ctx.user.id })
      .returning();
    await tx.insert(noteRevisions).values({ firmId, noteId: note.id, version: 1, body: note.body, visibility: note.visibility, editedById: ctx.user.id });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "note.created", entityType: "note", entityId: note.id, summary: `Added a${note.visibility === "client_visible" ? " client-visible" : "n internal"} note`, ip: ctx.ip }, tx);
    return note;
  });
}

async function loadNote(tx: Tx, ctx: AccessContext, firmId: string, noteId: string) {
  if (!z.string().uuid().safeParse(noteId).success) throw new NotFoundError("Note");
  const [n] = await tx.select().from(notes).where(and(eq(notes.id, noteId), eq(notes.firmId, firmId), isNull(notes.deletedAt))).for("update");
  if (!n) throw new NotFoundError("Note");
  const subject: NoteSubject = n.matterId ? { matterId: n.matterId } : n.clientId ? { clientId: n.clientId } : { leadId: n.leadId! };
  await checkSubject(tx, ctx, firmId, subject, true);
  if (n.authorId !== ctx.user.id && !ctx.has("firm:manage", firmId)) throw new AccessDeniedError("firm:manage");
  return n;
}

export async function editNote(ctx: AccessContext, firmId: string, noteId: string, raw: unknown) {
  const input = parseOrThrow(noteSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const n = await loadNote(tx, ctx, firmId, noteId);
    if (n.body === input.body && n.visibility === input.visibility) return n;
    const version = n.version + 1;
    const [note] = await tx.update(notes).set({ body: input.body, visibility: input.visibility, version, updatedById: ctx.user.id, updatedAt: new Date() }).where(eq(notes.id, n.id)).returning();
    await tx.insert(noteRevisions).values({ firmId, noteId: n.id, version, body: input.body, visibility: input.visibility, editedById: ctx.user.id });
    if (n.visibility !== input.visibility) {
      await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "note.visibility_changed", entityType: "note", entityId: n.id, summary: `Note changed from ${n.visibility.replace("_", "-")} to ${input.visibility.replace("_", "-")}`, ip: ctx.ip }, tx);
    }
    return note;
  });
}

export async function deleteNote(ctx: AccessContext, firmId: string, noteId: string) {
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const n = await loadNote(tx, ctx, firmId, noteId);
    await tx.update(notes).set({ deletedAt: new Date(), updatedById: ctx.user.id }).where(eq(notes.id, n.id));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "note.deleted", entityType: "note", entityId: n.id, summary: "Deleted a note (its history is kept)", ip: ctx.ip }, tx);
  });
}

export async function noteHistory(ctx: AccessContext, firmId: string, noteId: string) {
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [n] = await tx.select().from(notes).where(and(eq(notes.id, noteId), eq(notes.firmId, firmId)));
    if (!n) throw new NotFoundError("Note");
    await checkSubject(tx, ctx, firmId, n.matterId ? { matterId: n.matterId } : n.clientId ? { clientId: n.clientId } : { leadId: n.leadId! }, false);
    return tx
      .select({ version: noteRevisions.version, body: noteRevisions.body, visibility: noteRevisions.visibility, editedAt: noteRevisions.editedAt, editor: users.name })
      .from(noteRevisions)
      .leftJoin(users, eq(users.id, noteRevisions.editedById))
      .where(eq(noteRevisions.noteId, n.id))
      .orderBy(desc(noteRevisions.version));
  });
}

/** Search notes the person can see in a practice. */
export async function searchNotes(ctx: AccessContext, firmId: string, q: string) {
  const term = q.trim();
  if (term.length < 2) throw new ValidationError("Type at least two characters.");
  const like = `%${term.slice(0, 100).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const canMatters = ctx.has("matters:view_all", firmId) || ctx.has("matters:view_assigned", firmId);
  const canClients = ctx.has("clients:view_all", firmId) || ctx.has("clients:view_assigned", firmId);
  const canLeads = ctx.has("leads:view_all", firmId) || ctx.has("leads:view_assigned", firmId);
  const subjects: SQL[] = [];
  if (canMatters) {
    const { matterVisibility } = await import("../matters/matters");
    subjects.push(sql`${notes.matterId} in (select ${matters.id} from ${matters} where ${and(...matterVisibility(ctx, firmId))})`);
  }
  if (canClients) subjects.push(sql`${notes.clientId} in (select ${clients.id} from ${clients} where ${clients.firmId} = ${firmId} and ${clients.deletedAt} is null ${ctx.has("clients:view_all", firmId) ? sql`` : sql`and ${clients.primaryConsultantId} = ${ctx.user.id}`})`);
  if (canLeads) subjects.push(sql`${notes.leadId} in (select ${leads.id} from ${leads} where ${leads.firmId} = ${firmId} and ${leads.deletedAt} is null ${ctx.has("leads:view_all", firmId) ? sql`` : sql`and ${leads.assignedToId} = ${ctx.user.id}`})`);
  if (!subjects.length) throw new AccessDeniedError("notes:view");
  return withScope(ctx.scopeFor(firmId), (tx) =>
    tx
      .select({
        id: notes.id, body: notes.body, visibility: notes.visibility, createdAt: notes.createdAt, author: users.name, matterId: notes.matterId, clientId: notes.clientId, leadId: notes.leadId,
        subject: sql<string>`coalesce((select m.ref || ' · ' || m.title from matters m where m.id = ${notes.matterId}), (select c.ref || ' · ' || c.first_name || coalesce(' ' || c.last_name, '') from clients c where c.id = ${notes.clientId}), (select l.ref || ' · ' || l.first_name || coalesce(' ' || l.last_name, '') from leads l where l.id = ${notes.leadId}))`,
      })
      .from(notes)
      .leftJoin(users, eq(users.id, notes.authorId))
      .where(and(eq(notes.firmId, firmId), isNull(notes.deletedAt), ilike(notes.body, like), or(...subjects)))
      .orderBy(desc(notes.createdAt))
      .limit(100),
  );
}
