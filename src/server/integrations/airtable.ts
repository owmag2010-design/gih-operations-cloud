import "server-only";
import { env } from "../env";

/**
 * Minimal read-only Airtable Web API client for the mirror. Uses a personal
 * access token with data.records:read and schema.bases:read on the mirrored
 * bases. Airtable allows 5 requests per second per base; callers page
 * sequentially and back off on 429.
 */

export type AirtableField = { id: string; name: string; type: string; description?: string; options?: { linkedTableId?: string } & Record<string, unknown> };
export type AirtableTable = { id: string; name: string; primaryFieldId: string; description?: string; fields: AirtableField[] };
export type AirtableRecord = { id: string; createdTime: string; fields: Record<string, unknown> };

export class AirtableError extends Error {
  constructor(message: string, public status: number, public retryable: boolean) {
    super(message);
    this.name = "AirtableError";
  }
}

export interface AirtableApi {
  listBases(): Promise<{ id: string; name: string }[]>;
  tables(baseId: string): Promise<AirtableTable[]>;
  listRecords(baseId: string, tableId: string, opts: { offset?: string; filterByFormula?: string }): Promise<{ records: AirtableRecord[]; offset?: string }>;
  getRecord(baseId: string, tableId: string, recordId: string): Promise<AirtableRecord | null>;
}

let double: AirtableApi | null = null;
/** Tests replace the network client. */
export function __setAirtableTestDouble(api: AirtableApi | null) {
  double = api;
}

export function airtableConfigured() {
  return !!double || !!env().AIRTABLE_TOKEN;
}

const BASE = "https://api.airtable.com/v0";

async function call<T>(path: string): Promise<T> {
  const token = env().AIRTABLE_TOKEN;
  if (!token) throw new AirtableError("Airtable isn't connected: add AIRTABLE_TOKEN in the hosting settings.", 0, false);
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (res.ok) return (await res.json()) as T;
  const body = (await res.text().catch(() => "")).slice(0, 300);
  if (res.status === 429) throw new AirtableError("Airtable rate limit reached; the sync will retry.", 429, true);
  if (res.status === 401) throw new AirtableError("Airtable rejected the token (401). Check AIRTABLE_TOKEN.", 401, false);
  if (res.status === 403) throw new AirtableError("The Airtable token has no access to this base or table (403). Add the base to the token's access list.", 403, false);
  if (res.status === 404) throw new AirtableError("Airtable couldn't find this base or table (404). It may have been deleted or renamed.", 404, false);
  throw new AirtableError(`Airtable error ${res.status}: ${body}`, res.status, res.status >= 500);
}

const live: AirtableApi = {
  async listBases() {
    const out: { id: string; name: string }[] = [];
    let offset: string | undefined;
    do {
      const r = await call<{ bases: { id: string; name: string }[]; offset?: string }>(`/meta/bases${offset ? `?offset=${encodeURIComponent(offset)}` : ""}`);
      out.push(...r.bases.map((b) => ({ id: b.id, name: b.name })));
      offset = r.offset;
    } while (offset);
    return out;
  },
  async tables(baseId) {
    const r = await call<{ tables: AirtableTable[] }>(`/meta/bases/${baseId}/tables`);
    return r.tables;
  },
  async listRecords(baseId, tableId, opts) {
    const q = new URLSearchParams({ pageSize: "100", returnFieldsByFieldId: "true" });
    if (opts.offset) q.set("offset", opts.offset);
    if (opts.filterByFormula) q.set("filterByFormula", opts.filterByFormula);
    return call<{ records: AirtableRecord[]; offset?: string }>(`/${baseId}/${tableId}?${q}`);
  },
  async getRecord(baseId, tableId, recordId) {
    try {
      return await call<AirtableRecord>(`/${baseId}/${tableId}/${recordId}?returnFieldsByFieldId=true`);
    } catch (e) {
      if (e instanceof AirtableError && e.status === 404) return null;
      throw e;
    }
  },
};

export function airtable(): AirtableApi {
  return double ?? live;
}

/** Field types whose values Airtable calculates; they can never be edited from the dashboard. */
export const COMPUTED_TYPES = new Set([
  "formula", "rollup", "count", "multipleLookupValues", "lookup", "createdTime", "lastModifiedTime", "autoNumber", "createdBy", "lastModifiedBy", "button", "aiText",
]);
