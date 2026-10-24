import "server-only";
import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Scope, type Tx } from "../../db/client";
import { airtableRecords, airtableSources, airtableSyncRuns, clients, type MirrorField } from "../../db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../errors";
import { airtable, AirtableError, airtableConfigured, COMPUTED_TYPES, type AirtableTable } from "../../integrations/airtable";
import { optionalText, parseOrThrow } from "../../validation";

/**
 * Airtable mirror: a faithful, read-only copy of selected Airtable tables.
 *
 * - Initial import (full sync) pages through the whole table; incremental
 *   syncs fetch records changed since the last run (LAST_MODIFIED_TIME()).
 * - Full syncs also detect records that disappeared from Airtable. Those are
 *   marked removed, never deleted (retention policy: kept and shown as removed).
 * - Record ids are Airtable's own (rec…), so links between tables resolve
 *   exactly. Computed fields (formula, lookup, rollup…) are flagged.
 * - Nothing is written back to Airtable. Dashboard edits stay off until a
 *   write-back, conflict and loop-prevention design is agreed (docs/16).
 */

const FULL_EVERY_MS = 6 * 3600_000;
const MARGIN_MS = 5 * 60_000;

/* ───────── Access ───────── */

export function mirrorScope(ctx: AccessContext): Scope {
  return { orgId: ctx.orgId, userId: ctx.user.id, firmIds: ctx.firmIdsWith("clients:view_all"), mirror: ctx.has("mirror:view") || ctx.has("mirror:manage") };
}

export function canUseMirror(ctx: AccessContext) {
  return ctx.has("mirror:view") || ctx.has("mirror:manage") || ctx.firmIdsWith("clients:view_all").length > 0;
}

function canManageSource(ctx: AccessContext, s: { firmId: string | null }) {
  return ctx.has("mirror:manage") || (!!s.firmId && ctx.has("firm:manage", s.firmId));
}

function systemScope(orgId: string, firmId: string | null): Scope {
  return { orgId, userId: null, firmIds: firmId ? [firmId] : [], mirror: true };
}

/* ───────── Values ───────── */

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Attachment and thumbnail URLs are re-signed by Airtable on every read; ignore them for change detection.
    return `{${Object.keys(o).filter((k) => k !== "url" && k !== "thumbnails").sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function hashFields(fields: Record<string, unknown>) {
  return createHash("sha256").update(stable(fields)).digest("hex");
}

/** Plain text for a field value (used for the primary value and search). */
export function valueText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(valueText).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
    if (typeof o.filename === "string") return o.filename;
    if (typeof o.email === "string") return o.email;
    if (typeof o.text === "string") return o.text;
    if (typeof o.label === "string") return o.label;
  }
  return "";
}

/** Strip short-lived attachment URLs before storing; a fresh link is fetched on request. */
function storable(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && "filename" in (x as object) && "id" in (x as object))) {
      out[k] = (v as Record<string, unknown>[]).map((a) => ({ id: a.id, filename: a.filename, size: a.size ?? null, type: a.type ?? null }));
    } else out[k] = v;
  }
  return out;
}

function toMirrorFields(t: AirtableTable): MirrorField[] {
  return t.fields.map((f) => ({ id: f.id, name: f.name, type: f.type, computed: COMPUTED_TYPES.has(f.type), linkedTableId: f.type === "multipleRecordLinks" ? (f.options?.linkedTableId ?? null) : null, description: f.description ?? null }));
}

/* ───────── Configuration ───────── */

const addSchema = z.object({
  baseId: z.string().regex(/^app[A-Za-z0-9]{14}$/, "Choose a base."),
  tableId: z.string().regex(/^tbl[A-Za-z0-9]{14}$/, "Choose a table."),
  dataset: z.string().trim().min(2, "Name the dataset.").max(80),
  firmId: z.string().optional().transform((v) => (v ? v : null)),
  sourceOfTruth: z.enum(["airtable", "dashboard", "shared"]).default("airtable"),
  truthNote: optionalText(500),
});

export async function addSource(ctx: AccessContext, raw: unknown) {
  if (!ctx.has("mirror:manage")) throw new AccessDeniedError("mirror:manage");
  const input = parseOrThrow(addSchema, raw);
  if (input.firmId && !ctx.firms.has(input.firmId)) throw new ValidationError("You can only assign a dataset to a practice you belong to.", { firmId: "Choose one of your practices." });
  const tables = await airtable().tables(input.baseId);
  const t = tables.find((x) => x.id === input.tableId);
  if (!t) throw new ValidationError("That table isn't in the base, or the token can't see it.", { tableId: "Not found." });
  const bases = await airtable().listBases();
  const baseName = bases.find((b) => b.id === input.baseId)?.name ?? input.baseId;
  return withScope({ ...mirrorScope(ctx), firmIds: input.firmId ? [input.firmId] : [], mirror: true }, async (tx) => {
    const [s] = await tx
      .insert(airtableSources)
      .values({ orgId: ctx.orgId, firmId: input.firmId, baseId: input.baseId, baseName, tableId: t.id, tableName: t.name, dataset: input.dataset, primaryFieldId: t.primaryFieldId, fields: toMirrorFields(t), sourceOfTruth: input.sourceOfTruth, truthNote: input.truthNote ?? null, schemaCheckedAt: new Date(), createdById: ctx.user.id })
      .onConflictDoNothing()
      .returning();
    if (!s) throw new ValidationError("That table is already mirrored.");
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: input.firmId, action: "mirror.source_added", entityType: "airtable_source", entityId: s.id, summary: `Mirroring Airtable ${baseName} › ${t.name}`, ip: ctx.ip }, tx);
    return s;
  });
}

export async function setSourceEnabled(ctx: AccessContext, sourceId: string, enabled: boolean) {
  return withScope(mirrorScope(ctx), async (tx) => {
    const s = await loadSource(tx, sourceId);
    if (!canManageSource(ctx, s)) throw new AccessDeniedError("mirror:manage");
    await tx.update(airtableSources).set({ enabled, updatedAt: new Date(), nextAttemptAt: null, failures: 0 }).where(eq(airtableSources.id, s.id));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: s.firmId, action: enabled ? "mirror.source_resumed" : "mirror.source_paused", entityType: "airtable_source", entityId: s.id, summary: `${enabled ? "Resumed" : "Paused"} syncing ${s.dataset}`, ip: ctx.ip }, tx);
  });
}

async function loadSource(tx: Tx, sourceId: string) {
  if (!z.string().uuid().safeParse(sourceId).success) throw new NotFoundError("Dataset");
  const [s] = await tx.select().from(airtableSources).where(eq(airtableSources.id, sourceId));
  if (!s) throw new NotFoundError("Dataset");
  return s;
}

/* ───────── Sync ───────── */

export type SyncResult = { status: "ok" | "error" | "skipped"; kind: "full" | "incremental"; fetched: number; created: number; updated: number; unchanged: number; removed: number; restored: number; error?: string };

/**
 * Sync one source. Runs as the system (no user), within the source's own
 * practice scope. Writes happen in short transactions per page so a long
 * import never holds one huge transaction.
 */
export async function syncSource(orgId: string, sourceId: string, opts: { kind?: "full" | "incremental" | "auto"; trigger: string; deadline?: number }): Promise<SyncResult> {
  const lookup: Scope = { orgId, userId: null, firmIds: await orgFirmIds(orgId), mirror: true };
  const found = await withScope(lookup, (tx) => loadSource(tx, sourceId));
  const scope = systemScope(orgId, found.firmId);
  const s = await withScope(scope, (tx) => loadSource(tx, sourceId));
  const kind: "full" | "incremental" = opts.kind === "full" || opts.kind === "incremental" ? opts.kind : !s.lastFullSyncAt || Date.now() - s.lastFullSyncAt.getTime() > FULL_EVERY_MS || !s.cursor ? "full" : "incremental";
  const started = new Date();
  const [run] = await withScope(scope, (tx) => tx.insert(airtableSyncRuns).values({ orgId, firmId: s.firmId, sourceId: s.id, kind, trigger: opts.trigger }).returning());
  const tally = { fetched: 0, created: 0, updated: 0, unchanged: 0, removed: 0, restored: 0 };
  try {
    if (!airtableConfigured()) throw new AirtableError("Airtable isn't connected: add AIRTABLE_TOKEN in the hosting settings.", 0, false);
    // Schema: refresh field names, types and links each run.
    const tables = await airtable().tables(s.baseId);
    const t = tables.find((x) => x.id === s.tableId);
    if (!t) throw new AirtableError(`Table ${s.tableName} is no longer in ${s.baseName}, or the token can't see it.`, 404, false);
    await withScope(scope, (tx) => tx.update(airtableSources).set({ tableName: t.name, primaryFieldId: t.primaryFieldId, fields: toMirrorFields(t), schemaCheckedAt: new Date() }).where(eq(airtableSources.id, s.id)));

    const filter = kind === "incremental" && s.cursor
      ? `OR(IS_AFTER(LAST_MODIFIED_TIME(), DATETIME_PARSE('${new Date(s.cursor.getTime() - MARGIN_MS).toISOString()}')), IS_AFTER(CREATED_TIME(), DATETIME_PARSE('${new Date(s.cursor.getTime() - MARGIN_MS).toISOString()}')))`
      : undefined;
    const seen = new Set<string>();
    let offset: string | undefined;
    do {
      if (opts.deadline && Date.now() > opts.deadline) throw new AirtableError("Stopped before the time limit; the next run continues.", 0, true);
      const page = await airtable().listRecords(s.baseId, s.tableId, { offset, filterByFormula: filter });
      offset = page.offset;
      tally.fetched += page.records.length;
      await withScope(scope, async (tx) => {
        const ids = page.records.map((r) => r.id);
        const existing = ids.length ? await tx.select({ recordId: airtableRecords.recordId, hash: airtableRecords.hash, removedAt: airtableRecords.removedAt }).from(airtableRecords).where(and(eq(airtableRecords.sourceId, s.id), inArray(airtableRecords.recordId, ids))) : [];
        const byId = new Map(existing.map((e) => [e.recordId, e]));
        const now = new Date();
        for (const r of page.records) {
          seen.add(r.id);
          const fields = storable(r.fields);
          const hash = hashFields(fields);
          const primary = valueText(fields[t.primaryFieldId]).slice(0, 500) || null;
          const search = Object.values(fields).map(valueText).filter(Boolean).join(" · ").slice(0, 8000);
          const prev = byId.get(r.id);
          if (!prev) {
            await tx.insert(airtableRecords).values({ orgId, firmId: s.firmId, sourceId: s.id, recordId: r.id, fields, hash, primaryValue: primary, searchText: search, airtableCreatedAt: new Date(r.createdTime), firstSeenAt: now, lastSeenAt: now, lastChangedAt: now });
            tally.created++;
          } else if (prev.hash !== hash || prev.removedAt) {
            await tx.update(airtableRecords).set({ fields, hash, primaryValue: primary, searchText: search, lastSeenAt: now, lastChangedAt: prev.hash !== hash ? now : undefined, removedAt: null }).where(and(eq(airtableRecords.sourceId, s.id), eq(airtableRecords.recordId, r.id)));
            if (prev.removedAt) tally.restored++;
            if (prev.hash !== hash) tally.updated++;
          } else {
            await tx.update(airtableRecords).set({ lastSeenAt: now }).where(and(eq(airtableRecords.sourceId, s.id), eq(airtableRecords.recordId, r.id)));
            tally.unchanged++;
          }
        }
      });
    } while (offset);

    await withScope(scope, async (tx) => {
      if (kind === "full") {
        // Records not returned by a complete full sync were deleted in Airtable: keep them, mark removed.
        const gone = await tx
          .update(airtableRecords)
          .set({ removedAt: new Date() })
          .where(and(eq(airtableRecords.sourceId, s.id), isNull(airtableRecords.removedAt), seen.size ? sql`${airtableRecords.recordId} <> all(${`{${[...seen].join(",")}}`}::text[])` : sql`true`))
          .returning({ id: airtableRecords.id });
        tally.removed = gone.length;
      }
      await tx
        .update(airtableSources)
        .set({ cursor: started, lastSyncAt: new Date(), lastSuccessAt: new Date(), ...(kind === "full" ? { lastFullSyncAt: new Date(), sourceCount: tally.fetched } : {}), lastError: null, failures: 0, nextAttemptAt: null, updatedAt: new Date() })
        .where(eq(airtableSources.id, s.id));
      await tx.update(airtableSyncRuns).set({ status: "ok", ...tally, finishedAt: new Date() }).where(eq(airtableSyncRuns.id, run.id));
    });
    return { status: "ok", kind, ...tally };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failures = s.failures + 1;
    const backoff = Math.min(2 ** Math.min(failures, 7) * 5 * 60_000, 6 * 3600_000);
    await withScope(scope, async (tx) => {
      await tx.update(airtableSources).set({ lastSyncAt: new Date(), lastError: message.slice(0, 500), failures, nextAttemptAt: new Date(Date.now() + backoff), updatedAt: new Date() }).where(eq(airtableSources.id, s.id));
      await tx.update(airtableSyncRuns).set({ status: "error", ...tally, error: message.slice(0, 500), finishedAt: new Date() }).where(eq(airtableSyncRuns.id, run.id));
    });
    return { status: "error", kind, ...tally, error: message };
  }
}

async function orgFirmIds(orgId: string): Promise<string[]> {
  const { db } = await import("../../db/client");
  const res = await db().execute<{ id: string }>(sql`select id from firms where org_id = ${orgId}`);
  return res.rows.map((r) => r.id);
}

/** Cron: sync every enabled source that is due, oldest first, until the deadline. */
export async function runDueMirrorSyncs(deadline: number) {
  if (!airtableConfigured()) return { synced: 0, skipped: "not configured" as const };
  const { db } = await import("../../db/client");
  const orgs = await db().execute<{ id: string }>(sql`select id from organisations`);
  const firmsRes = await db().execute<{ id: string; org_id: string }>(sql`select id, org_id from firms`);
  let synced = 0;
  const results: { sourceId: string; status: string }[] = [];
  for (const { id: orgId } of orgs.rows) {
    const firmIds = firmsRes.rows.filter((f) => f.org_id === orgId).map((f) => f.id);
    const due = await withScope({ orgId, userId: null, firmIds, mirror: true }, (tx) =>
      tx
        .select({ id: airtableSources.id })
        .from(airtableSources)
        .where(and(eq(airtableSources.orgId, orgId), eq(airtableSources.enabled, true), or(isNull(airtableSources.nextAttemptAt), lte(airtableSources.nextAttemptAt, new Date()))))
        .orderBy(sql`${airtableSources.lastSyncAt} asc nulls first`),
    );
    for (const d of due) {
      if (Date.now() > deadline - 15_000) break;
      const r = await syncSource(orgId, d.id, { kind: "auto", trigger: "schedule", deadline: deadline - 10_000 });
      results.push({ sourceId: d.id, status: r.status });
      synced++;
    }
  }
  return { synced, results };
}

/** "Sync now" / "Run a full sync" from the dashboard. */
export async function syncNow(ctx: AccessContext, sourceId: string, kind: "full" | "incremental") {
  const s = await withScope(mirrorScope(ctx), (tx) => loadSource(tx, sourceId));
  if (!canManageSource(ctx, s)) throw new AccessDeniedError("mirror:manage");
  const r = await syncSource(ctx.orgId, s.id, { kind, trigger: `manual:${ctx.user.id}`, deadline: Date.now() + 50_000 });
  await withScope(mirrorScope(ctx), (tx) => audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: s.firmId, action: "mirror.synced", entityType: "airtable_source", entityId: s.id, summary: `${kind === "full" ? "Full" : "Incremental"} sync of ${s.dataset}: ${r.status}`, ip: ctx.ip }, tx));
  return r;
}

/* ───────── Reading ───────── */

export async function listSources(ctx: AccessContext) {
  if (!canUseMirror(ctx)) throw new AccessDeniedError("mirror:view");
  return withScope(mirrorScope(ctx), async (tx) => {
    const rows = await tx
      .select({
        s: airtableSources,
        active: sql<number>`(select count(*)::int from airtable_records r where r.source_id = ${airtableSources.id} and r.removed_at is null)`,
        removed: sql<number>`(select count(*)::int from airtable_records r where r.source_id = ${airtableSources.id} and r.removed_at is not null)`,
        firmName: sql<string | null>`(select trading_name from firms f where f.id = ${airtableSources.firmId})`,
        firmSlug: sql<string | null>`(select slug from firms f where f.id = ${airtableSources.firmId})`,
      })
      .from(airtableSources)
      .where(eq(airtableSources.orgId, ctx.orgId))
      .orderBy(asc(airtableSources.firmId), asc(airtableSources.position), asc(airtableSources.dataset));
    return rows.map((r) => ({ ...r.s, active: Number(r.active), removed: Number(r.removed), firmName: r.firmName, firmSlug: r.firmSlug, canManage: canManageSource(ctx, r.s) }));
  });
}

export async function getSource(ctx: AccessContext, sourceId: string) {
  if (!canUseMirror(ctx)) throw new AccessDeniedError("mirror:view");
  return withScope(mirrorScope(ctx), async (tx) => {
    const s = await loadSource(tx, sourceId);
    const runs = await tx.select().from(airtableSyncRuns).where(eq(airtableSyncRuns.sourceId, s.id)).orderBy(desc(airtableSyncRuns.startedAt)).limit(10);
    const linked = await linkTargets(tx, s);
    return { source: s, runs, linked, canManage: canManageSource(ctx, s) };
  });
}

/** For each link field, the mirrored source of the linked table (if mirrored). */
async function linkTargets(tx: Tx, s: typeof airtableSources.$inferSelect) {
  const ids = [...new Set(s.fields.map((f) => f.linkedTableId).filter((x): x is string => !!x))];
  if (!ids.length) return {} as Record<string, { id: string; dataset: string } | null>;
  const rows = await tx.select({ id: airtableSources.id, tableId: airtableSources.tableId, dataset: airtableSources.dataset }).from(airtableSources).where(and(eq(airtableSources.baseId, s.baseId), inArray(airtableSources.tableId, ids)));
  const out: Record<string, { id: string; dataset: string } | null> = {};
  for (const f of s.fields) if (f.linkedTableId) out[f.id] = rows.find((r) => r.tableId === f.linkedTableId) ?? null;
  return out;
}

export async function listMirrorRecords(ctx: AccessContext, sourceId: string, f: { q?: string; show?: "active" | "removed" | "all"; page?: number } = {}) {
  if (!canUseMirror(ctx)) throw new AccessDeniedError("mirror:view");
  return withScope(mirrorScope(ctx), async (tx) => {
    const s = await loadSource(tx, sourceId);
    const conds: SQL[] = [eq(airtableRecords.sourceId, s.id)];
    if (f.show !== "all") conds.push(f.show === "removed" ? isNotNull(airtableRecords.removedAt) : isNull(airtableRecords.removedAt));
    if (f.q?.trim()) conds.push(ilike(airtableRecords.searchText, `%${f.q.trim().slice(0, 100).replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
    const page = Math.max(1, Math.floor(f.page ?? 1));
    const rows = await tx.select().from(airtableRecords).where(and(...conds)).orderBy(desc(airtableRecords.airtableCreatedAt)).limit(50).offset((page - 1) * 50);
    const [{ total }] = await tx.select({ total: count() }).from(airtableRecords).where(and(...conds));
    const names = await linkedNames(tx, s, rows.map((r) => r.fields));
    return { source: s, rows, total: Number(total), page, pageSize: 50, names };
  });
}

/** Primary values for linked record ids found in `fieldsList`, within the same base. */
async function linkedNames(tx: Tx, s: typeof airtableSources.$inferSelect, fieldsList: Record<string, unknown>[]) {
  const ids = new Set<string>();
  for (const f of s.fields.filter((x) => x.linkedTableId)) for (const fields of fieldsList) for (const v of (Array.isArray(fields[f.id]) ? (fields[f.id] as unknown[]) : [])) if (typeof v === "string") ids.add(v);
  if (!ids.size) return {} as Record<string, { name: string | null; sourceId: string; removed: boolean }>;
  const rows = await tx
    .select({ recordId: airtableRecords.recordId, name: airtableRecords.primaryValue, sourceId: airtableRecords.sourceId, removedAt: airtableRecords.removedAt })
    .from(airtableRecords)
    .innerJoin(airtableSources, eq(airtableSources.id, airtableRecords.sourceId))
    .where(and(eq(airtableSources.baseId, s.baseId), inArray(airtableRecords.recordId, [...ids])));
  return Object.fromEntries(rows.map((r) => [r.recordId, { name: r.name, sourceId: r.sourceId, removed: !!r.removedAt }]));
}

export async function getMirrorRecord(ctx: AccessContext, sourceId: string, recordId: string) {
  if (!canUseMirror(ctx)) throw new AccessDeniedError("mirror:view");
  return withScope(mirrorScope(ctx), async (tx) => {
    const s = await loadSource(tx, sourceId);
    const [r] = await tx.select().from(airtableRecords).where(and(eq(airtableRecords.sourceId, s.id), eq(airtableRecords.recordId, recordId)));
    if (!r) throw new NotFoundError("Record");
    const names = await linkedNames(tx, s, [r.fields]);
    const linked = await linkTargets(tx, s);
    // Records elsewhere that link to this one (reverse links), e.g. a client's matters.
    const back = await tx
      .select({ sourceId: airtableRecords.sourceId, recordId: airtableRecords.recordId, name: airtableRecords.primaryValue, dataset: airtableSources.dataset })
      .from(airtableRecords)
      .innerJoin(airtableSources, eq(airtableSources.id, airtableRecords.sourceId))
      .where(and(eq(airtableSources.baseId, s.baseId), isNull(airtableRecords.removedAt), sql`${airtableRecords.fields}::text like ${`%"${recordId}"%`}`, sql`${airtableRecords.id} <> ${r.id}`))
      .limit(200);
    return { source: s, record: r, names, linked, back };
  });
}

/** Fresh download link for an attachment (Airtable's links expire after a few hours). */
export async function attachmentUrl(ctx: AccessContext, sourceId: string, recordId: string, fieldId: string, attachmentId: string) {
  const { source } = await getMirrorRecord(ctx, sourceId, recordId);
  const fresh = await airtable().getRecord(source.baseId, source.tableId, recordId);
  const list = fresh?.fields[fieldId];
  const hit = Array.isArray(list) ? (list as { id: string; url: string }[]).find((a) => a.id === attachmentId) : null;
  if (!hit?.url) throw new NotFoundError("Attachment");
  return hit.url;
}

/* ───────── Reconciliation ───────── */

export async function reconcile(ctx: AccessContext, sourceId: string) {
  if (!canUseMirror(ctx)) throw new AccessDeniedError("mirror:view");
  return withScope(mirrorScope(ctx), async (tx) => {
    const s = await loadSource(tx, sourceId);
    const [{ active, removed, changedSinceFull }] = await tx
      .select({
        active: sql<number>`count(*) filter (where ${airtableRecords.removedAt} is null)::int`,
        removed: sql<number>`count(*) filter (where ${airtableRecords.removedAt} is not null)::int`,
        changedSinceFull: sql<number>`count(*) filter (where ${airtableRecords.lastChangedAt} > coalesce(${s.lastFullSyncAt}, 'epoch'::timestamptz) and ${airtableRecords.removedAt} is null)::int`,
      })
      .from(airtableRecords)
      .where(eq(airtableRecords.sourceId, s.id));
    const removedRows = await tx.select({ recordId: airtableRecords.recordId, name: airtableRecords.primaryValue, removedAt: airtableRecords.removedAt }).from(airtableRecords).where(and(eq(airtableRecords.sourceId, s.id), isNotNull(airtableRecords.removedAt))).orderBy(desc(airtableRecords.removedAt)).limit(100);

    // Links: to mirrored tables, every id should exist; links to tables not mirrored are listed.
    const linked = await linkTargets(tx, s);
    const linkIssues: { fieldId: string; fieldName: string; target: string | null; missing: { recordId: string; from: string; fromName: string | null }[]; removedTargets: number; notMirrored: boolean }[] = [];
    const recs = await tx.select({ recordId: airtableRecords.recordId, name: airtableRecords.primaryValue, fields: airtableRecords.fields }).from(airtableRecords).where(and(eq(airtableRecords.sourceId, s.id), isNull(airtableRecords.removedAt)));
    for (const f of s.fields.filter((x) => x.linkedTableId)) {
      const target = linked[f.id];
      const refs: { id: string; from: string; fromName: string | null }[] = [];
      for (const r of recs) for (const v of Array.isArray(r.fields[f.id]) ? (r.fields[f.id] as unknown[]) : []) if (typeof v === "string") refs.push({ id: v, from: r.recordId, fromName: r.name });
      if (!target) {
        linkIssues.push({ fieldId: f.id, fieldName: f.name, target: null, missing: [], removedTargets: 0, notMirrored: true });
        continue;
      }
      const ids = [...new Set(refs.map((x) => x.id))];
      const found = ids.length ? await tx.select({ recordId: airtableRecords.recordId, removedAt: airtableRecords.removedAt }).from(airtableRecords).where(and(eq(airtableRecords.sourceId, target.id), inArray(airtableRecords.recordId, ids))) : [];
      const have = new Map(found.map((x) => [x.recordId, x]));
      const missing = refs.filter((x) => !have.has(x.id)).slice(0, 50).map((x) => ({ recordId: x.id, from: x.from, fromName: x.fromName }));
      const removedTargets = refs.filter((x) => have.get(x.id)?.removedAt).length;
      linkIssues.push({ fieldId: f.id, fieldName: f.name, target: target.dataset, missing, removedTargets, notMirrored: false });
    }

    // Against the dashboard: mirrored clients with an email that no dashboard client in the practice has.
    let notInDashboard: { recordId: string; name: string | null; email: string }[] | null = null;
    if (s.mapsTo === "clients" && s.firmId) {
      const emailField = s.fields.find((f) => f.type === "email");
      if (emailField) {
        const emails = recs.map((r) => ({ recordId: r.recordId, name: r.name, email: valueText(r.fields[emailField.id]).trim().toLowerCase() })).filter((x) => x.email);
        const known = emails.length ? await tx.select({ email: clients.email }).from(clients).where(and(eq(clients.firmId, s.firmId), isNull(clients.deletedAt), inArray(clients.email, emails.map((e) => e.email)))) : [];
        const set = new Set(known.map((k) => String(k.email).toLowerCase()));
        notInDashboard = emails.filter((e) => !set.has(e.email)).slice(0, 100);
      }
    }
    return {
      source: s,
      counts: { active: Number(active), removed: Number(removed), sourceCount: s.sourceCount, changedSinceFull: Number(changedSinceFull) },
      countMatches: s.sourceCount === null ? null : s.sourceCount === Number(active),
      removedRows,
      linkIssues,
      notInDashboard,
      computedFields: s.fields.filter((f) => f.computed).map((f) => f.name),
    };
  });
}

export function mirrorConnected() {
  return airtableConfigured();
}
