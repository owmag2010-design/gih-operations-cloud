import "server-only";
import { db, type Tx } from "./db/client";
import { auditEvents } from "./db/schema";

export type AuditInput = {
  orgId: string;
  actorId: string | null;
  action: string;
  firmId?: string | null;
  entityType?: string;
  entityId?: string;
  summary?: string;
  data?: Record<string, unknown>;
  ip?: string | null;
};

/**
 * Append an audit event. Pass the surrounding transaction so the event commits
 * (or rolls back) with the change it describes. Never put secrets or full
 * documents in `data`.
 */
export async function audit(input: AuditInput, tx?: Tx) {
  await (tx ?? db()).insert(auditEvents).values({
    orgId: input.orgId,
    actorId: input.actorId,
    action: input.action,
    firmId: input.firmId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: input.summary,
    data: input.data ?? {},
    ip: input.ip ?? null,
  });
}
