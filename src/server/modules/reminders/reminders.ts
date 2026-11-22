import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { decrypt } from "../../auth/crypto";
import { db, withScope, type Scope, type Tx } from "../../db/client";
import {
  clients, documentRequests, firmMemberships, firms, matterDates, matterPeople, matters, portalAccess, reminderLog, reminderSettings, roles, users,
} from "../../db/schema";
import { env } from "../../env";
import { AccessDeniedError } from "../../errors";
import { sendEmail } from "../../integrations/email";
import { parseOrThrow } from "../../validation";
import { loadVisibleMatter } from "../matters/matters";
import { portalLink } from "../portal/client";
import { clientEmail, staffAlertEmail } from "../portal/emails";

/**
 * Reminders: a daily job that nudges clients about documents still outstanding
 * (through their portal) and sends each team member a digest of what needs
 * them. Both are off until a practice administrator turns them on. Every
 * reminder is claimed in reminder_log before it is sent, so a re-run or a
 * second job on the same day never sends it twice.
 */

export type ReminderSettings = {
  clientNudges: boolean;
  nudgeEveryDays: number;
  staffDigest: boolean;
  deadlineWindowDays: number;
  expiryWindowDays: number;
  updatedAt: Date | null;
};

export const DEFAULT_SETTINGS: ReminderSettings = { clientNudges: false, nudgeEveryDays: 7, staffDigest: false, deadlineWindowDays: 7, expiryWindowDays: 90, updatedAt: null };

const settingsSchema = z.object({
  clientNudges: z.boolean(),
  nudgeEveryDays: z.coerce.number().int().min(3, "Remind clients at most every 3 days").max(30, "Remind clients at least every 30 days"),
  staffDigest: z.boolean(),
  deadlineWindowDays: z.coerce.number().int().min(1).max(60, "Look at most 60 days ahead for deadlines"),
  expiryWindowDays: z.coerce.number().int().min(14, "Look at least 14 days ahead for expiring documents").max(365),
});

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (isoDate: string, n: number) => iso(new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 864e5));

async function readSettings(tx: Tx, firmId: string): Promise<ReminderSettings> {
  const [row] = await tx.select().from(reminderSettings).where(eq(reminderSettings.firmId, firmId));
  return row
    ? { clientNudges: row.clientNudges, nudgeEveryDays: row.nudgeEveryDays, staffDigest: row.staffDigest, deadlineWindowDays: row.deadlineWindowDays, expiryWindowDays: row.expiryWindowDays, updatedAt: row.updatedAt }
    : DEFAULT_SETTINGS;
}

/* ───────────── settings (practice administrators) ───────────── */

export async function getReminderSettings(ctx: AccessContext, firmId: string) {
  if (!ctx.has("firm:view", firmId)) throw new AccessDeniedError("firm:view");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const settings = await readSettings(tx, firmId);
    const since = new Date(Date.now() - 7 * 864e5);
    const recent = await tx
      .select({ kind: reminderLog.kind, status: reminderLog.status, n: sql<number>`count(*)::int` })
      .from(reminderLog)
      .where(and(eq(reminderLog.firmId, firmId), gte(reminderLog.createdAt, since)))
      .groupBy(reminderLog.kind, reminderLog.status);
    return { settings, recent, canEdit: ctx.has("firm:manage", firmId) };
  });
}

export async function saveReminderSettings(ctx: AccessContext, firmId: string, raw: unknown) {
  if (!ctx.has("firm:manage", firmId)) throw new AccessDeniedError("firm:manage");
  const input = parseOrThrow(settingsSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const before = await readSettings(tx, firmId);
    await tx
      .insert(reminderSettings)
      .values({ firmId, ...input, updatedById: ctx.user.id })
      .onConflictDoUpdate({ target: reminderSettings.firmId, set: { ...input, updatedById: ctx.user.id, updatedAt: new Date() } });
    const changes: string[] = [];
    if (before.clientNudges !== input.clientNudges) changes.push(`client reminders ${input.clientNudges ? "on" : "off"}`);
    if (before.staffDigest !== input.staffDigest) changes.push(`team digest ${input.staffDigest ? "on" : "off"}`);
    if (before.nudgeEveryDays !== input.nudgeEveryDays) changes.push(`client reminders every ${input.nudgeEveryDays} days`);
    if (before.deadlineWindowDays !== input.deadlineWindowDays) changes.push(`deadlines ${input.deadlineWindowDays} days ahead`);
    if (before.expiryWindowDays !== input.expiryWindowDays) changes.push(`expiring documents ${input.expiryWindowDays} days ahead`);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "reminders.settings", entityType: "firm", entityId: firmId, summary: `Reminders: ${changes.join(", ") || "saved, no changes"}`, ip: ctx.ip }, tx);
    return input;
  });
}

/** Reminders sent to the client on one matter, newest first. */
export async function matterReminders(ctx: AccessContext, firmId: string, matterId: string) {
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const matter = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const settings = await readSettings(tx, firmId);
    const rows = await tx
      .select({ id: reminderLog.id, createdAt: reminderLog.createdAt, items: reminderLog.items, status: reminderLog.status, recipient: reminderLog.recipient })
      .from(reminderLog)
      .where(and(eq(reminderLog.matterId, matter.id), eq(reminderLog.kind, "client_documents")))
      .orderBy(desc(reminderLog.createdAt))
      .limit(5);
    return { enabled: settings.clientNudges, everyDays: settings.nudgeEveryDays, sent: rows };
  });
}

/* ───────────── planning (pure reads, testable) ───────────── */

export type ClientNudge = {
  matterId: string; matterRef: string; matterTitle: string; firmName: string;
  email: string; firstName: string; tokenEnc: string;
  items: { label: string; dueOn: string | null; replacement: boolean }[];
};

export type StaffDigest = {
  userId: string; name: string; email: string;
  overdue: { label: string; dueOn: string; matterRef: string; matterId: string }[];
  review: { label: string; matterRef: string; matterId: string }[];
  expiring: { label: string; expiresOn: string; matterRef: string; matterId: string }[];
  deadlines: { label: string; dueOn: string; matterRef: string; matterId: string }[];
};

/**
 * Which clients to remind today. A matter qualifies when its client has an open,
 * invited portal and required client-visible documents still outstanding, and
 * one of them is due within three days, was asked for a new copy, or has waited
 * the practice's interval, unless a reminder already went within that interval.
 */
export async function planClientNudges(tx: Tx, firmId: string, settings: ReminderSettings, today: string): Promise<ClientNudge[]> {
  const soon = addDays(today, 3);
  const waited = new Date(Date.parse(`${addDays(today, -settings.nudgeEveryDays)}T23:59:59Z`));
  const recentFrom = new Date(Date.parse(`${addDays(today, -settings.nudgeEveryDays + 1)}T00:00:00Z`));
  const [firm] = await tx.select({ name: firms.tradingName }).from(firms).where(eq(firms.id, firmId));

  const rows = await tx
    .select({
      matterId: matters.id, matterRef: matters.ref, matterTitle: matters.title,
      email: portalAccess.email, tokenEnc: portalAccess.tokenEnc, firstName: clients.firstName,
      label: documentRequests.label, dueOn: documentRequests.dueOn, status: documentRequests.status, createdAt: documentRequests.createdAt,
      person: matterPeople.firstName,
    })
    .from(documentRequests)
    .innerJoin(matters, eq(matters.id, documentRequests.matterId))
    .innerJoin(portalAccess, and(eq(portalAccess.matterId, matters.id), isNull(portalAccess.revokedAt), sql`${portalAccess.invitedAt} is not null`))
    .innerJoin(clients, eq(clients.id, matters.clientId))
    .leftJoin(matterPeople, eq(matterPeople.id, documentRequests.personId))
    .where(and(
      eq(documentRequests.firmId, firmId), isNull(matters.closedAt),
      eq(documentRequests.clientVisible, true), eq(documentRequests.required, true),
      inArray(documentRequests.status, ["requested", "rejected"]),
    ))
    .orderBy(asc(matters.ref), asc(documentRequests.position));

  const recent = new Set(
    (await tx
      .select({ matterId: reminderLog.matterId })
      .from(reminderLog)
      .where(and(eq(reminderLog.firmId, firmId), eq(reminderLog.kind, "client_documents"), gte(reminderLog.createdAt, recentFrom), sql`${reminderLog.status} <> 'failed'`)))
      .map((r) => r.matterId),
  );

  const byMatter = new Map<string, ClientNudge & { due: boolean }>();
  for (const r of rows) {
    if (recent.has(r.matterId)) continue;
    let n = byMatter.get(r.matterId);
    if (!n) {
      n = { matterId: r.matterId, matterRef: r.matterRef, matterTitle: r.matterTitle, firmName: firm?.name ?? "", email: r.email, firstName: r.firstName ?? "", tokenEnc: r.tokenEnc, items: [], due: false };
      byMatter.set(r.matterId, n);
    }
    n.items.push({ label: r.person ? `${r.label} (${r.person})` : r.label, dueOn: r.dueOn, replacement: r.status === "rejected" });
    if (r.status === "rejected" || (r.dueOn && r.dueOn <= soon) || r.createdAt <= waited) n.due = true;
  }
  return [...byMatter.values()].filter((n) => n.due).map((n) => ({ matterId: n.matterId, matterRef: n.matterRef, matterTitle: n.matterTitle, firmName: n.firmName, email: n.email, firstName: n.firstName, tokenEnc: n.tokenEnc, items: n.items }));
}

/** What each active team member needs to see, on open matters they're on. Members with nothing are left out. */
export async function planStaffDigests(tx: Tx, firmId: string, settings: ReminderSettings, today: string): Promise<StaffDigest[]> {
  const people = await tx
    .select({ userId: users.id, name: users.name, email: users.email, permissions: roles.permissions })
    .from(firmMemberships)
    .innerJoin(users, eq(users.id, firmMemberships.userId))
    .innerJoin(roles, eq(roles.id, firmMemberships.roleId))
    .where(and(eq(firmMemberships.firmId, firmId), eq(firmMemberships.status, "active"), eq(users.status, "active"), eq(users.kind, "staff")));
  if (!people.length) return [];

  const team = sql<string[]>`array_remove(array[${matters.caseManagerId}, ${matters.consultantId}] || coalesce((select array_agg(mm.user_id) from matter_members mm where mm.matter_id = ${matters.id}), '{}'), null)`;
  const expiryTo = addDays(today, settings.expiryWindowDays);
  const deadlineTo = addDays(today, settings.deadlineWindowDays);

  const reqs = await tx
    .select({ label: documentRequests.label, status: documentRequests.status, dueOn: documentRequests.dueOn, expiresOn: documentRequests.expiresOn, matterId: matters.id, matterRef: matters.ref, team })
    .from(documentRequests)
    .innerJoin(matters, eq(matters.id, documentRequests.matterId))
    .where(and(
      eq(documentRequests.firmId, firmId), isNull(matters.closedAt),
      sql`(
        (${documentRequests.status} in ('requested', 'rejected') and ${documentRequests.dueOn} < ${today})
        or ${documentRequests.status} in ('received', 'under_review')
        or (${documentRequests.status} = 'accepted' and ${documentRequests.expiresOn} <= ${expiryTo})
      )`,
    ))
    .orderBy(asc(matters.ref), asc(documentRequests.position));

  const dates = await tx
    .select({ label: matterDates.label, dueOn: matterDates.dueOn, matterId: matters.id, matterRef: matters.ref, team })
    .from(matterDates)
    .innerJoin(matters, eq(matters.id, matterDates.matterId))
    .where(and(eq(matterDates.firmId, firmId), isNull(matters.closedAt), isNull(matterDates.completedAt), gte(matterDates.dueOn, today), lte(matterDates.dueOn, deadlineTo)))
    .orderBy(asc(matterDates.dueOn));

  const out: StaffDigest[] = [];
  for (const p of people) {
    const reviewer = p.permissions.includes("documents:approve");
    const d: StaffDigest = { userId: p.userId, name: p.name, email: p.email, overdue: [], review: [], expiring: [], deadlines: [] };
    for (const r of reqs) {
      if (!(r.team ?? []).includes(p.userId)) continue;
      const at = { label: r.label, matterRef: r.matterRef, matterId: r.matterId };
      if (r.status === "accepted" && r.expiresOn) d.expiring.push({ ...at, expiresOn: r.expiresOn });
      else if (r.status === "received" || r.status === "under_review") { if (reviewer) d.review.push(at); }
      else if (r.dueOn) d.overdue.push({ ...at, dueOn: r.dueOn });
    }
    for (const x of dates) if ((x.team ?? []).includes(p.userId)) d.deadlines.push({ label: x.label, dueOn: x.dueOn, matterRef: x.matterRef, matterId: x.matterId });
    if (d.overdue.length + d.review.length + d.expiring.length + d.deadlines.length) out.push(d);
  }
  return out;
}

/* ───────────── sending (the daily job) ───────────── */

const systemScope = (orgId: string, firmId: string): Scope => ({ orgId, userId: null, firmIds: [firmId], matterAdminFirms: [firmId] });

async function claim(tx: Tx, row: typeof reminderLog.$inferInsert) {
  const [r] = await tx.insert(reminderLog).values(row).onConflictDoNothing().returning({ id: reminderLog.id });
  return r?.id ?? null;
}

function fmt(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function clientNudgeEmail(n: ClientNudge, link: string) {
  const count = n.items.length;
  return clientEmail({
    kicker: "Documents still needed",
    heading: n.matterTitle,
    subline: `Reference ${n.matterRef} · ${n.firmName}, a Global Immigration Hub partner firm`,
    greeting: `Dear ${n.firstName || "client"},`,
    body: [
      count === 1 ? "We're still waiting for one document for your application." : `We're still waiting for ${count} documents for your application.`,
      "Please upload them in your portal. If you've already sent them by email, you can ignore this message.",
    ],
    panelTitle: "Still needed",
    panelLines: n.items.slice(0, 12).map((i) => `${i.label}${i.replacement ? " (please send a new copy)" : ""}${i.dueOn ? ` · by ${fmt(i.dueOn)}` : ""}`).concat(count > 12 ? [`and ${count - 12} more in your portal`] : []),
    actionLabel: "Upload in my portal",
    actionUrl: link,
    footer: "This link is private to you. Please don't forward it. We don't accept documents on WhatsApp.",
  });
}

export function staffDigestEmail(d: StaffDigest, firmName: string) {
  const lines: string[] = [];
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(`${title} (${items.length})`, ...items.slice(0, 15).map((i) => `• ${i}`), ...(items.length > 15 ? [`• and ${items.length - 15} more`] : []), "");
  };
  section("Deadlines coming up", d.deadlines.map((x) => `${x.label} · ${x.matterRef} · ${fmt(x.dueOn)}`));
  section("Client documents overdue", d.overdue.map((x) => `${x.label} · ${x.matterRef} · due ${fmt(x.dueOn)}`));
  section("Documents waiting for review", d.review.map((x) => `${x.label} · ${x.matterRef}`));
  section("Accepted documents expiring", d.expiring.map((x) => `${x.label} · ${x.matterRef} · expires ${fmt(x.expiresOn)}`));
  return staffAlertEmail({ heading: `Your day at ${firmName}`, lines: [`Hello ${d.name.split(" ")[0]}, here's what needs you on your matters.`, "", ...lines], actionLabel: "Open My day", actionUrl: `${env().APP_URL}/today` });
}

export type RunReport = { firmId: string; clientSent: number; digestsSent: number; failed: number; skipped: number };

/** One practice. `today` is a UTC date (YYYY-MM-DD); keys use it, so a second run that day sends nothing new. */
export async function runFirmReminders(orgId: string, firmId: string, today = iso(new Date())): Promise<RunReport> {
  const report: RunReport = { firmId, clientSent: 0, digestsSent: 0, failed: 0, skipped: 0 };
  const scope = systemScope(orgId, firmId);
  const plan = await withScope(scope, async (tx) => {
    const settings = await readSettings(tx, firmId);
    const [firm] = await tx.select({ name: firms.tradingName, slug: firms.slug, status: firms.status }).from(firms).where(eq(firms.id, firmId));
    if (!firm || firm.status !== "active") return null;
    return {
      firm,
      nudges: settings.clientNudges ? await planClientNudges(tx, firmId, settings, today) : [],
      digests: settings.staffDigest ? await planStaffDigests(tx, firmId, settings, today) : [],
    };
  });
  if (!plan) return report;

  for (const n of plan.nudges) {
    let link: string;
    try {
      link = portalLink(decrypt(n.tokenEnc));
    } catch {
      report.skipped++;
      continue;
    }
    const id = await withScope(scope, (tx) => claim(tx, { firmId, kind: "client_documents", matterId: n.matterId, recipient: n.email, dedupeKey: `client:${n.matterId}:${today}`, items: n.items.length }));
    if (!id) { report.skipped++; continue; }
    const mail = clientNudgeEmail(n, link);
    const res = await sendEmail({ orgId, firmId, to: n.email, subject: `Documents still needed · ${n.matterRef}`, template: "reminder_client_documents", ...mail }).catch(() => ({ status: "failed" as const }));
    await withScope(scope, (tx) => tx.update(reminderLog).set({ status: res.status }).where(eq(reminderLog.id, id)));
    if (res.status === "failed") report.failed++; else report.clientSent++;
  }

  for (const d of plan.digests) {
    const id = await withScope(scope, (tx) => claim(tx, { firmId, kind: "staff_digest", userId: d.userId, recipient: d.email, dedupeKey: `digest:${d.userId}:${today}`, items: d.overdue.length + d.review.length + d.expiring.length + d.deadlines.length }));
    if (!id) { report.skipped++; continue; }
    const mail = staffDigestEmail(d, plan.firm.name);
    const res = await sendEmail({ orgId, firmId, to: d.email, subject: `Your day at ${plan.firm.name}`, template: "reminder_staff_digest", ...mail }).catch(() => ({ status: "failed" as const }));
    await withScope(scope, (tx) => tx.update(reminderLog).set({ status: res.status }).where(eq(reminderLog.id, id)));
    if (res.status === "failed") report.failed++; else report.digestsSent++;
  }
  return report;
}

/** Every practice with something switched on, across organisations. */
export async function runDueReminders(today = iso(new Date())): Promise<RunReport[]> {
  const orgs = await db().execute<{ id: string }>(sql`select id from organisations`);
  const reports: RunReport[] = [];
  for (const { id: orgId } of orgs.rows) {
    const firmIds = await withScope({ orgId, userId: null, firmIds: [] }, (tx) =>
      tx.select({ id: firms.id }).from(firms).where(and(eq(firms.orgId, orgId), eq(firms.status, "active"))),
    );
    for (const { id } of firmIds) reports.push(await runFirmReminders(orgId, id, today));
  }
  return reports;
}
