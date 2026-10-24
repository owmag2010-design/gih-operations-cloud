import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";

const KIND_LETTER = { lead: "L", client: "C", proposal: "P", matter: "M", document: "D" } as const;

/**
 * Next human-readable reference for a firm, e.g. MG-L-000042.
 * The upsert takes a row lock, so concurrent callers get distinct numbers.
 */
export async function nextRef(tx: Tx, firmId: string, prefix: string, kind: keyof typeof KIND_LETTER): Promise<string> {
  const res = await tx.execute<{ value: number }>(sql`
    insert into firm_sequences (firm_id, key, value) values (${firmId}, ${kind}, 1)
    on conflict (firm_id, key) do update set value = firm_sequences.value + 1
    returning value`);
  const value = Number(res.rows[0].value);
  return `${prefix}-${KIND_LETTER[kind]}-${String(value).padStart(6, "0")}`;
}
