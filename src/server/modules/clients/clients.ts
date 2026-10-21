import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Tx } from "../../db/client";
import { activities, clients, consentRecords, leads, users } from "../../db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../errors";
import { normalisePhone, optionalCountry, optionalEmail, optionalText, optionalUuid, parseOrThrow } from "../../validation";
import { nextRef } from "../refs";

const clientSchema = z
  .object({
    firstName: z.string().trim().min(1, "Enter a first name.").max(80),
    lastName: optionalText(80),
    email: optionalEmail,
    phone: optionalText(40),
    nationality: optionalCountry,
    countryOfResidence: optionalCountry,
    status: z.enum(["active", "inactive", "archived"]).default("active"),
    primaryConsultantId: optionalUuid,
  })
  .refine((v) => v.email || v.phone, { message: "Add an email address or a phone number.", path: ["email"] });

function viewMode(ctx: AccessContext, firmId: string) {
  if (ctx.has("clients:view_all", firmId)) return "all" as const;
  if (ctx.has("clients:view_assigned", firmId)) return "assigned" as const;
  throw new AccessDeniedError("clients:view");
}

function visibility(ctx: AccessContext, firmId: string): SQL[] {
  const c: SQL[] = [eq(clients.firmId, firmId), isNull(clients.deletedAt)];
  if (viewMode(ctx, firmId) === "assigned") c.push(eq(clients.primaryConsultantId, ctx.user.id));
  return c;
}

async function loadVisible(tx: Tx, ctx: AccessContext, firmId: string, id: string, lock = false) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Client");
  const q = tx.select().from(clients).where(and(eq(clients.id, id), ...visibility(ctx, firmId))).limit(1);
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw new NotFoundError("Client");
  return row;
}

async function assertConsultant(tx: Tx, firmId: string, userId?: string) {
  if (!userId) return;
  const res = await tx.execute(sql`select 1 from firm_memberships m join users u on u.id = m.user_id
    where m.firm_id = ${firmId} and m.user_id = ${userId} and m.status = 'active' and u.status = 'active'`);
  if (!res.rows.length) throw new ValidationError("Choose a member of this firm.", { primaryConsultantId: "Choose a member of this firm." });
}

export type ClientFilters = { q?: string; status?: string; consultant?: string; page?: number };

export async function listClients(ctx: AccessContext, firmId: string, f: ClientFilters = {}) {
  const conds = visibility(ctx, firmId);
  if (f.q) {
    const term = `%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(clients.firstName, term), ilike(clients.lastName, term), ilike(sql`${clients.firstName} || ' ' || coalesce(${clients.lastName}, '')`, term), ilike(clients.email, term), ilike(clients.phone, term), ilike(clients.ref, term))!);
  }
  if (f.status && ["active", "inactive", "archived"].includes(f.status)) conds.push(eq(clients.status, f.status as "active"));
  else if (!f.status) conds.push(eq(clients.status, "active"));
  if (f.consultant === "me") conds.push(eq(clients.primaryConsultantId, ctx.user.id));
  const page = Math.max(1, Math.floor(f.page ?? 1));
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const rows = await tx
      .select({
        id: clients.id, ref: clients.ref, firstName: clients.firstName, lastName: clients.lastName, email: clients.email, phone: clients.phone,
        nationality: clients.nationality, countryOfResidence: clients.countryOfResidence, status: clients.status, createdAt: clients.createdAt,
        consultantName: users.name,
      })
      .from(clients)
      .leftJoin(users, eq(users.id, clients.primaryConsultantId))
      .where(and(...conds))
      .orderBy(desc(clients.createdAt))
      .limit(50)
      .offset((page - 1) * 50);
    const [{ total }] = await tx.select({ total: count() }).from(clients).where(and(...conds));
    return { rows, total, page, pageSize: 50 };
  });
}

export async function getClient(ctx: AccessContext, firmId: string, id: string) {
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const client = await loadVisible(tx, ctx, firmId, id);
    const consultant = client.primaryConsultantId
      ? (await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, client.primaryConsultantId)))[0] ?? null
      : null;
    const sourceLead = client.sourceLeadId
      ? (await tx.select({ id: leads.id, ref: leads.ref, enquiry: leads.enquiry, immigrationCategory: leads.immigrationCategory, destinationCountry: leads.destinationCountry }).from(leads).where(eq(leads.id, client.sourceLeadId)))[0] ?? null
      : null;
    const timeline = await tx
      .select({ id: activities.id, type: activities.type, body: activities.body, data: activities.data, createdAt: activities.createdAt, actorName: users.name })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.actorId))
      .where(eq(activities.clientId, client.id))
      .orderBy(desc(activities.createdAt))
      .limit(200);
    const consents = await tx.select().from(consentRecords).where(eq(consentRecords.clientId, client.id)).orderBy(desc(consentRecords.recordedAt));
    return { client, consultant, sourceLead, timeline, consents };
  });
}

export async function createClient(ctx: AccessContext, firmId: string, raw: unknown) {
  ctx.require("clients:create", firmId);
  const input = parseOrThrow(clientSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    await assertConsultant(tx, firmId, input.primaryConsultantId);
    const [client] = await tx
      .insert(clients)
      .values({
        firmId, ref: await nextRef(tx, firmId, ctx.firm(firmId).refPrefix, "client"),
        firstName: input.firstName, lastName: input.lastName, email: input.email, phone: normalisePhone(input.phone, input.countryOfResidence),
        nationality: input.nationality, countryOfResidence: input.countryOfResidence, status: input.status,
        primaryConsultantId: input.primaryConsultantId ?? ctx.user.id, createdById: ctx.user.id,
      })
      .returning();
    await tx.insert(activities).values({ firmId, clientId: client.id, type: "created", actorId: ctx.user.id });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "client.created", entityType: "client", entityId: client.id, summary: `Created client ${client.ref}`, ip: ctx.ip }, tx);
    return client;
  });
}

export async function updateClient(ctx: AccessContext, firmId: string, id: string, raw: unknown) {
  ctx.require("clients:edit", firmId);
  const input = parseOrThrow(clientSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const before = await loadVisible(tx, ctx, firmId, id, true);
    await assertConsultant(tx, firmId, input.primaryConsultantId);
    const [client] = await tx
      .update(clients)
      .set({
        firstName: input.firstName, lastName: input.lastName ?? null, email: input.email ?? null, phone: normalisePhone(input.phone, input.countryOfResidence) ?? null,
        nationality: input.nationality ?? null, countryOfResidence: input.countryOfResidence ?? null, status: input.status,
        primaryConsultantId: input.primaryConsultantId ?? before.primaryConsultantId, updatedAt: new Date(),
      })
      .where(eq(clients.id, before.id))
      .returning();
    await tx.insert(activities).values({ firmId, clientId: client.id, type: "updated", actorId: ctx.user.id });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "client.updated", entityType: "client", entityId: client.id, summary: `Updated client ${client.ref}`, ip: ctx.ip }, tx);
    return client;
  });
}

export async function addClientNote(ctx: AccessContext, firmId: string, id: string, body: string) {
  ctx.require("clients:edit", firmId);
  const text = body.trim();
  if (!text || text.length > 5000) throw new ValidationError("Write a note of up to 5,000 characters.", { body: "Required." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const client = await loadVisible(tx, ctx, firmId, id);
    await tx.insert(activities).values({ firmId, clientId: client.id, type: "note", body: text, actorId: ctx.user.id });
  });
}

export async function exportClientsCsv(ctx: AccessContext, firmId: string, f: ClientFilters) {
  ctx.require("clients:export", firmId);
  const all = await withScope(ctx.scopeFor(firmId), (tx) =>
    tx.select().from(clients).where(and(...visibility(ctx, firmId))).orderBy(asc(clients.ref)).limit(5000),
  );
  const cell = (v: unknown) => {
    let s = v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = f.status ? all.filter((c) => c.status === f.status) : all;
  const csv = [["Reference", "First name", "Last name", "Email", "Phone", "Nationality", "Country of residence", "Status", "Created"].join(",")]
    .concat(rows.map((c) => [c.ref, c.firstName, c.lastName, c.email, c.phone, c.nationality, c.countryOfResidence, c.status, c.createdAt].map(cell).join(",")))
    .join("\r\n");
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "client.exported", entityType: "client", summary: `Exported ${rows.length} client(s) to CSV`, data: { count: rows.length }, ip: ctx.ip });
  return csv;
}
