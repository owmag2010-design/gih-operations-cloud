import "server-only";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { AccessContext } from "../access/context";
import { withScope } from "../db/client";
import { clients, intakeItems, leads } from "../db/schema";

export type SearchHit = { kind: "lead" | "client" | "enquiry"; id: string; title: string; subtitle: string; href: string };

/** Search across every firm the user can see, respecting assigned-only roles. */
export async function globalSearch(ctx: AccessContext, raw: string): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const term = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const hits: SearchHit[] = [];

  const leadAll = ctx.firmIdsWith("leads:view_all");
  const leadOwn = ctx.firmIdsWith("leads:view_assigned").filter((id) => !leadAll.includes(id));
  const clientAll = ctx.firmIdsWith("clients:view_all");
  const clientOwn = ctx.firmIdsWith("clients:view_assigned").filter((id) => !clientAll.includes(id));
  const slug = (id: string) => ctx.firms.get(id)?.slug ?? "";
  const firmName = (id: string) => ctx.firms.get(id)?.tradingName ?? "";
  const full = (a: string, b: string | null) => `${a}${b ? ` ${b}` : ""}`;

  if (leadAll.length || leadOwn.length || clientAll.length || clientOwn.length) {
    await withScope(ctx.scopeForAllFirms(), async (tx) => {
      if (leadAll.length || leadOwn.length) {
        const rows = await tx
          .select({ id: leads.id, firmId: leads.firmId, ref: leads.ref, firstName: leads.firstName, lastName: leads.lastName, email: leads.email })
          .from(leads)
          .where(
            and(
              isNull(leads.deletedAt),
              or(
                leadAll.length ? inArray(leads.firmId, leadAll) : undefined,
                leadOwn.length ? and(inArray(leads.firmId, leadOwn), eq(leads.assignedToId, ctx.user.id)) : undefined,
              ),
              or(ilike(sql`${leads.firstName} || ' ' || coalesce(${leads.lastName}, '')`, term), ilike(leads.email, term), ilike(leads.phone, term), ilike(leads.ref, term)),
            ),
          )
          .orderBy(desc(leads.updatedAt))
          .limit(8);
        for (const r of rows) hits.push({ kind: "lead", id: r.id, title: full(r.firstName, r.lastName), subtitle: `${r.ref} · ${firmName(r.firmId)}${r.email ? ` · ${r.email}` : ""}`, href: `/f/${slug(r.firmId)}/leads/${r.id}` });
      }
      if (clientAll.length || clientOwn.length) {
        const rows = await tx
          .select({ id: clients.id, firmId: clients.firmId, ref: clients.ref, firstName: clients.firstName, lastName: clients.lastName, email: clients.email })
          .from(clients)
          .where(
            and(
              isNull(clients.deletedAt),
              or(
                clientAll.length ? inArray(clients.firmId, clientAll) : undefined,
                clientOwn.length ? and(inArray(clients.firmId, clientOwn), eq(clients.primaryConsultantId, ctx.user.id)) : undefined,
              ),
              or(ilike(sql`${clients.firstName} || ' ' || coalesce(${clients.lastName}, '')`, term), ilike(clients.email, term), ilike(clients.phone, term), ilike(clients.ref, term)),
            ),
          )
          .orderBy(desc(clients.updatedAt))
          .limit(8);
        for (const r of rows) hits.push({ kind: "client", id: r.id, title: full(r.firstName, r.lastName), subtitle: `${r.ref} · ${firmName(r.firmId)}${r.email ? ` · ${r.email}` : ""}`, href: `/f/${slug(r.firmId)}/clients/${r.id}` });
      }
    });
  }

  if (ctx.has("intake:view")) {
    const rows = await withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [], intake: true }, (tx) =>
      tx
        .select({ id: intakeItems.id, firstName: intakeItems.firstName, lastName: intakeItems.lastName, email: intakeItems.email, status: intakeItems.status })
        .from(intakeItems)
        .where(and(eq(intakeItems.orgId, ctx.orgId), or(ilike(sql`${intakeItems.firstName} || ' ' || coalesce(${intakeItems.lastName}, '')`, term), ilike(intakeItems.email, term), ilike(intakeItems.phone, term))))
        .orderBy(desc(intakeItems.receivedAt))
        .limit(6),
    );
    for (const r of rows) hits.push({ kind: "enquiry", id: r.id, title: full(r.firstName, r.lastName), subtitle: `Hub enquiry · ${r.status}${r.email ? ` · ${r.email}` : ""}`, href: `/hq/intake/${r.id}` });
  }
  return hits;
}
