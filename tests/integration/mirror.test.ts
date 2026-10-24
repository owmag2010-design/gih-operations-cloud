import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/schema";
import { AccessDeniedError, NotFoundError } from "../../src/server/errors";
import { __setAirtableTestDouble, type AirtableApi, type AirtableRecord, type AirtableTable } from "../../src/server/integrations/airtable";
import { getMirrorRecord, getSource, listMirrorRecords, listSources, reconcile, runDueMirrorSyncs, syncNow, syncSource } from "../../src/server/modules/mirror/mirror";
import { makeUser, owner, resetDatabase } from "../support/fixtures";

const BASE = "appqEsnjIF4D3C6Tr";
const CLIENTS = "tblHknfR1UBMvI8VU";
const MATTERS = "tblFSyRBPgsgObays";
const MIMSHAC_BASE = "apptJDeGy4EHghBsM";
const MIMSHAC_CLIENTS = "tblYPxxOpqg9QYu5a";

function fakeAirtable() {
  const tables: Record<string, AirtableTable[]> = {
    [BASE]: [
      { id: CLIENTS, name: "Clients (CRM)", primaryFieldId: "fldName0000000001", fields: [
        { id: "fldName0000000001", name: "Client Name", type: "singleLineText" },
        { id: "fldMail0000000001", name: "Email", type: "email" },
        { id: "fldMatt0000000001", name: "Matters", type: "multipleRecordLinks", options: { linkedTableId: MATTERS } },
        { id: "fldTeam0000000001", name: "Case Manager", type: "multipleRecordLinks", options: { linkedTableId: "tblnlWabrLTMUTArJ" } },
        { id: "fldDocs0000000001", name: "File", type: "multipleAttachments" },
      ] },
      { id: MATTERS, name: "Matters", primaryFieldId: "fldMatN0000000001", fields: [
        { id: "fldMatN0000000001", name: "Matter", type: "singleLineText" },
        { id: "fldClie0000000001", name: "Client", type: "multipleRecordLinks", options: { linkedTableId: CLIENTS } },
        { id: "fldLook0000000001", name: "Client email", type: "multipleLookupValues" },
      ] },
    ],
    [MIMSHAC_BASE]: [
      { id: MIMSHAC_CLIENTS, name: "Clients (CRM)", primaryFieldId: "fldMName000000001", fields: [{ id: "fldMName000000001", name: "Client Name", type: "singleLineText" }, { id: "fldMMail000000001", name: "Email", type: "email" }] },
    ],
  };
  const records: Record<string, AirtableRecord[]> = {
    [CLIENTS]: [
      { id: "recClientA0000001", createdTime: "2026-10-01T00:00:00.000Z", fields: { fldName0000000001: "Alice Example", fldMail0000000001: "alice@test.example", fldMatt0000000001: ["recMatterA0000001"], fldDocs0000000001: [{ id: "attA", filename: "passport.pdf", size: 10, type: "application/pdf", url: "https://dl.airtable.test/a?sig=1" }] } },
      { id: "recClientB0000001", createdTime: "2026-10-02T00:00:00.000Z", fields: { fldName0000000001: "Bongani Example", fldMatt0000000001: ["recMissing0000001"] } },
    ],
    [MATTERS]: [{ id: "recMatterA0000001", createdTime: "2026-10-03T00:00:00.000Z", fields: { fldMatN0000000001: "Spouse visa", fldClie0000000001: ["recClientA0000001"], fldLook0000000001: ["alice@test.example"] } }],
    [MIMSHAC_CLIENTS]: [{ id: "recMimshac0000001", createdTime: "2026-10-01T00:00:00.000Z", fields: { fldMName000000001: "Mpho Example", fldMMail000000001: "mpho@test.example" } }],
  };
  const calls: { table: string; filter?: string }[] = [];
  let fail: Error | null = null;
  const api: AirtableApi = {
    async listBases() { return [{ id: BASE, name: "Global Immigration Hub" }, { id: MIMSHAC_BASE, name: "Mimshac Group — Clients" }]; },
    async tables(baseId) { if (fail) throw fail; return tables[baseId] ?? []; },
    async listRecords(_b, tableId, opts) {
      calls.push({ table: tableId, filter: opts.filterByFormula });
      // Two records per page, to exercise paging.
      const all = records[tableId] ?? [];
      const start = opts.offset ? Number(opts.offset) : 0;
      const page = all.slice(start, start + 2).map((r) => ({ ...r, fields: JSON.parse(JSON.stringify(r.fields)) }));
      // Re-sign attachment URLs like Airtable does.
      for (const r of page) for (const v of Object.values(r.fields)) if (Array.isArray(v)) for (const a of v) if (a && typeof a === "object" && "url" in a) (a as { url: string }).url += `&t=${Date.now()}`;
      return { records: page, offset: start + 2 < all.length ? String(start + 2) : undefined };
    },
    async getRecord(_b, tableId, recordId) { return (records[tableId] ?? []).find((r) => r.id === recordId) ?? null; },
  };
  return { api, records, calls, setFail: (e: Error | null) => { fail = e; } };
}

async function sourceId(table: string) {
  const [r] = await owner.select({ id: s.airtableSources.id }).from(s.airtableSources).where(eq(s.airtableSources.tableId, table));
  return r.id;
}

describe("airtable mirror", () => {
  let fake: ReturnType<typeof fakeAirtable>;
  beforeEach(async () => {
    await resetDatabase();
    fake = fakeAirtable();
    __setAirtableTestDouble(fake.api);
  });
  afterEach(() => __setAirtableTestDouble(null));

  it("imports records with stable ids, resolves links, and reconciles changes and deletions without deleting", async () => {
    const hub = await makeUser({ group: "group_super_admin" });
    const [org] = await owner.select().from(s.organisations).limit(1);
    const clientsId = await sourceId(CLIENTS);
    const mattersId = await sourceId(MATTERS);

    const first = await syncSource(org.id, clientsId, { kind: "auto", trigger: "test" });
    expect(first).toMatchObject({ status: "ok", kind: "full", fetched: 2, created: 2 });
    await syncSource(org.id, mattersId, { kind: "auto", trigger: "test" });

    const { rows, names } = await listMirrorRecords(hub, clientsId);
    expect(rows.map((r) => r.recordId).sort()).toEqual(["recClientA0000001", "recClientB0000001"]);
    expect(names.recMatterA0000001?.name).toBe("Spouse visa");
    // Attachment links are not stored (they expire); file names are.
    const alice = rows.find((r) => r.recordId === "recClientA0000001")!;
    expect(JSON.stringify(alice.fields)).not.toContain("dl.airtable.test");
    expect(JSON.stringify(alice.fields)).toContain("passport.pdf");

    const detail = await getMirrorRecord(hub, clientsId, "recClientA0000001");
    expect(detail.back.map((b) => b.recordId)).toEqual(["recMatterA0000001"]);
    const matters = (await getSource(hub, mattersId));
    expect(matters.source.fields.find((f) => f.name === "Client email")?.computed).toBe(true);

    // A second full sync with nothing changed: re-signed URLs don't count as changes.
    const again = await syncSource(org.id, clientsId, { kind: "full", trigger: "test" });
    expect(again).toMatchObject({ unchanged: 2, updated: 0 });

    // Incremental sync uses Airtable's modified time.
    fake.records[CLIENTS][1].fields.fldName0000000001 = "Bongani Example-Dube";
    const inc = await syncSource(org.id, clientsId, { kind: "auto", trigger: "test" });
    expect(inc.kind).toBe("incremental");
    expect(fake.calls.at(-1)?.filter).toContain("LAST_MODIFIED_TIME()");
    expect(inc.updated).toBe(1);

    // Deleted in Airtable: kept and marked removed by the next full sync.
    fake.records[CLIENTS].splice(1, 1);
    const full = await syncSource(org.id, clientsId, { kind: "full", trigger: "test" });
    expect(full.removed).toBe(1);
    const removed = await listMirrorRecords(hub, clientsId, { show: "removed" });
    expect(removed.rows.map((r) => r.primaryValue)).toEqual(["Bongani Example-Dube"]);
    const priv = await owner.execute<{ can: boolean }>(sql`select has_table_privilege('gih_app', 'airtable_records', 'DELETE') as can`);
    expect(priv.rows[0].can).toBe(false);

    const rec = await reconcile(hub, clientsId);
    expect(rec.counts).toMatchObject({ active: 1, removed: 1, sourceCount: 1 });
    expect(rec.countMatches).toBe(true);
    const caseManager = rec.linkIssues.find((l) => l.fieldName === "Case Manager");
    expect(caseManager?.notMirrored).toBe(false); // the Hub Team table is configured
    // Back in Airtable: restored.
    fake.records[CLIENTS].push({ id: "recClientB0000001", createdTime: "2026-10-02T00:00:00.000Z", fields: { fldName0000000001: "Bongani Example-Dube", fldMatt0000000001: ["recMissing0000001"] } });
    const back = await syncSource(org.id, clientsId, { kind: "full", trigger: "test" });
    expect(back.restored).toBe(1);
    const rec2 = await reconcile(hub, clientsId);
    expect(rec2.linkIssues.find((l) => l.fieldName === "Matters")?.missing.map((m) => m.recordId)).toEqual(["recMissing0000001"]);
  });

  it("keeps Hub datasets from practice staff and practice datasets within the practice", async () => {
    const [org] = await owner.select().from(s.organisations).limit(1);
    const veritasConsultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const mimshacConsultant = await makeUser({ firms: { mimshac: "immigration_consultant" } });
    const hubOps = await makeUser({ group: "group_ops_admin" });
    const hubId = await sourceId(CLIENTS);
    const mimshacId = await sourceId(MIMSHAC_CLIENTS);
    await syncSource(org.id, hubId, { kind: "full", trigger: "test" });
    await syncSource(org.id, mimshacId, { kind: "full", trigger: "test" });

    expect((await listSources(veritasConsultant)).map((x) => x.id)).not.toContain(hubId);
    await expect(listMirrorRecords(veritasConsultant, hubId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listMirrorRecords(veritasConsultant, mimshacId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listMirrorRecords(mimshacConsultant, mimshacId)).rows).toHaveLength(1);
    // Group roles see Hub datasets but never a practice's.
    expect((await listMirrorRecords(hubOps, hubId)).rows).toHaveLength(2);
    await expect(listMirrorRecords(hubOps, mimshacId)).rejects.toBeInstanceOf(NotFoundError);
    // Only managers can trigger syncs.
    await expect(syncNow(mimshacConsultant, mimshacId, "full")).rejects.toBeInstanceOf(AccessDeniedError);

    // Reconciliation against the dashboard: Mimshac's Airtable client isn't a dashboard client yet.
    const rec = await reconcile(mimshacConsultant, mimshacId);
    expect(rec.notInDashboard?.map((x) => x.email)).toEqual(["mpho@test.example"]);
  });

  it("records errors, backs off and retries", async () => {
    const [org] = await owner.select().from(s.organisations).limit(1);
    const id = await sourceId(CLIENTS);
    fake.setFail(new Error("Airtable rate limit reached; the sync will retry."));
    const r = await syncSource(org.id, id, { kind: "full", trigger: "test" });
    expect(r.status).toBe("error");
    const [row] = await owner.select().from(s.airtableSources).where(eq(s.airtableSources.id, id));
    expect(row.failures).toBe(1);
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    const runs = await owner.select().from(s.airtableSyncRuns).where(eq(s.airtableSyncRuns.sourceId, id));
    expect(runs.map((x) => x.status)).toEqual(["error"]);
    fake.setFail(null);
    // The schedule skips it until the back-off passes; a manual retry works now.
    const due = await runDueMirrorSyncs(Date.now() + 50_000);
    expect(((due as { results?: { sourceId: string }[] }).results ?? []).map((x) => x.sourceId)).not.toContain(id);
    const hub = await makeUser({ group: "group_super_admin" });
    expect((await syncNow(hub, id, "full")).status).toBe("ok");
  });
});
