import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { db, withScope, type Scope, type Tx } from "../../db/client";
import { decrypt, encrypt } from "../../auth/crypto";
import { emailMessages, emailThreads, mailboxes, mailConnections, storedFiles, type MailImportState } from "../../db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../errors";
import { resendGetReceivedAttachment } from "../../integrations/resend";
import { googleAdapter } from "../../integrations/mail/google";
import { microsoftAdapter } from "../../integrations/mail/microsoft";
import { accountProfile, authorizeUrl, exchangeCode, providerConfigured, refreshTokens, signState, verifyState, type OAuthState } from "../../integrations/mail/oauth";
import { ProviderAuthError, type ConnectionView, type MailAdapter, type OutgoingMessage, type Provider, type SendAccepted, type SyncedMessage, type Tokens } from "../../integrations/mail/types";
import { canManageMailbox, canSendInbox, canViewInbox, inboxScope, visibleMailboxes } from "./access";
import { fileMail } from "./mail";
import { safeFilename } from "./files";

/**
 * Provider mailbox connections: connect (OAuth), history import, ongoing sync,
 * sending through the provider, attachment download.
 *
 * Sync is pull-based: a scheduled job (every few minutes) and "Sync now" read
 * the provider's change feed (Microsoft delta links, Gmail history ids). That
 * also reconciles anything a push notification would have missed. Imported
 * history never opens Hub enquiries and isn't marked unread.
 */

export const HISTORY_DAYS = 90;

/* ───────────── adapters (replaceable in tests) ───────────── */

let override: Partial<Record<Provider, MailAdapter>> = {};
let tokenOverride: { exchange?: typeof exchangeCode; refresh?: typeof refreshTokens; profile?: typeof accountProfile } = {};
export function __setMailTestDoubles(a: Partial<Record<Provider, MailAdapter>>, t: typeof tokenOverride = {}) {
  override = a;
  tokenOverride = t;
}
const adapterFor = (p: Provider): MailAdapter => override[p] ?? (p === "microsoft" ? microsoftAdapter() : googleAdapter());

const systemScope = (orgId: string, firmId: string | null): Scope => ({ orgId, userId: null, firmIds: firmId ? [firmId] : [], intake: !firmId, mailSystem: true });

/* ───────────── connecting ───────────── */

const connectSchema = z.object({
  provider: z.enum(["microsoft", "google"]),
  mailboxId: z.string().uuid().optional().nullable(),
  /** For a new personal mailbox: which practice it belongs to ("hub" or a firm id). */
  practice: z.string().optional().nullable(),
});

/** Start an OAuth connection. Returns the provider URL and the nonce to set as a cookie. */
export async function beginConnect(ctx: AccessContext, raw: unknown) {
  const input = connectSchema.parse(raw);
  if (!providerConfigured(input.provider)) throw new ValidationError(input.provider === "microsoft" ? "Microsoft 365 isn't set up on the server yet (Azure app registration needed)." : "Gmail isn't set up on the server yet (Google OAuth client needed).");
  let state: Omit<OAuthState, "nonce" | "exp">;
  let hint: string | null = null;
  if (input.mailboxId) {
    const box = await withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [] }, async (tx) => (await tx.select().from(mailboxes).where(and(eq(mailboxes.id, input.mailboxId!), eq(mailboxes.orgId, ctx.orgId))))[0]);
    if (!box) throw new NotFoundError("Mailbox");
    if (!canManageMailbox(ctx, box)) throw new AccessDeniedError("mailboxes:manage");
    state = { mailboxId: box.id, userId: ctx.user.id, provider: input.provider, firmId: box.firmId, kind: box.kind };
    hint = box.fromAddress;
  } else {
    const firmId = input.practice && input.practice !== "hub" ? input.practice : null;
    if (firmId && !z.string().uuid().safeParse(firmId).success) throw new ValidationError("Choose a practice.");
    if (!canSendInbox(ctx, firmId)) throw new AccessDeniedError(firmId ? "email:send" : "hub_email:send");
    state = { mailboxId: null, userId: ctx.user.id, provider: input.provider, firmId, kind: "personal" };
    hint = ctx.user.email;
  }
  const { state: signed, nonce } = signState(state);
  return { url: authorizeUrl(input.provider, signed, hint), nonce };
}

/** Finish an OAuth connection: store encrypted tokens and start the history import. */
export async function completeConnect(ctx: AccessContext, rawState: string, code: string, cookieNonce: string | undefined) {
  const st = verifyState(rawState, cookieNonce);
  if (!st || st.userId !== ctx.user.id) throw new ValidationError("This connection link has expired or wasn't started here. Start again from Settings › Email.");
  const tokens = await (tokenOverride.exchange ?? exchangeCode)(st.provider, code);
  if (!tokens.refreshToken) throw new ValidationError("The provider didn't grant offline access. Try again and accept all requested permissions.");
  const profile = await (tokenOverride.profile ?? accountProfile)(st.provider, tokens.accessToken);
  if (!profile.email) throw new ValidationError("Couldn't read the mailbox address from the provider.");

  return withScope(systemScope(ctx.orgId, st.firmId), async (tx) => {
    let mailbox: typeof mailboxes.$inferSelect;
    if (st.mailboxId) {
      const [box] = await tx.select().from(mailboxes).where(and(eq(mailboxes.id, st.mailboxId), eq(mailboxes.orgId, ctx.orgId)));
      if (!box || !canManageMailbox(ctx, box)) throw new AccessDeniedError("mailboxes:manage");
      if (box.kind === "personal" && profile.email !== box.fromAddress.toLowerCase()) throw new ValidationError(`You signed in as ${profile.email}, but this mailbox is ${box.fromAddress}. Sign in with that account.`);
      [mailbox] = await tx.update(mailboxes).set({ provider: st.provider, updatedAt: new Date() }).where(eq(mailboxes.id, box.id)).returning();
    } else {
      if (!canSendInbox(ctx, st.firmId)) throw new AccessDeniedError("email:send");
      const [existing] = await tx.select().from(mailboxes).where(and(eq(mailboxes.orgId, ctx.orgId), eq(mailboxes.kind, "personal"), eq(mailboxes.ownerUserId, ctx.user.id), eq(mailboxes.fromAddress, profile.email), st.firmId ? eq(mailboxes.firmId, st.firmId) : isNull(mailboxes.firmId)));
      if (existing) {
        [mailbox] = await tx.update(mailboxes).set({ provider: st.provider, isActive: true, updatedAt: new Date() }).where(eq(mailboxes.id, existing.id)).returning();
      } else {
        [mailbox] = await tx
          .insert(mailboxes)
          .values({ orgId: ctx.orgId, firmId: st.firmId, label: profile.email, fromName: profile.name ?? ctx.user.name, fromAddress: profile.email, kind: "personal", ownerUserId: ctx.user.id, provider: st.provider })
          .returning();
      }
    }
    const importState: MailImportState = { since: new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString(), phase: "inbox", pageToken: null, imported: 0, skipped: 0, startedAt: new Date().toISOString(), finishedAt: null };
    const values = {
      orgId: ctx.orgId, mailboxId: mailbox.id, provider: st.provider, accountEmail: profile.email,
      accessTokenEnc: encrypt(tokens.accessToken), refreshTokenEnc: encrypt(tokens.refreshToken!), tokenExpiresAt: tokens.expiresAt, scopes: tokens.scopes,
      status: "connected" as const, syncCursor: {}, importState, lastError: null, failureCount: 0, connectedById: ctx.user.id, connectedAt: new Date(), updatedAt: new Date(),
    };
    const [existingConn] = await tx.select({ id: mailConnections.id }).from(mailConnections).where(eq(mailConnections.mailboxId, mailbox.id));
    const [conn] = existingConn
      ? await tx.update(mailConnections).set(values).where(eq(mailConnections.id, existingConn.id)).returning()
      : await tx.insert(mailConnections).values(values).returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: mailbox.firmId, action: "mailbox.connected", entityType: "mailbox", entityId: mailbox.id, summary: `Connected ${profile.email} (${st.provider === "microsoft" ? "Microsoft 365" : "Gmail"})`, ip: ctx.ip }, tx);
    return { mailbox, connectionId: conn.id };
  });
}

export async function disconnectMailbox(ctx: AccessContext, mailboxId: string) {
  if (!z.string().uuid().safeParse(mailboxId).success) throw new NotFoundError("Mailbox");
  await withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [] }, async (tx) => {
    const [box] = await tx.select().from(mailboxes).where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.orgId, ctx.orgId)));
    if (!box) throw new NotFoundError("Mailbox");
    if (!canManageMailbox(ctx, box)) throw new AccessDeniedError("mailboxes:manage");
    await tx.update(mailConnections).set({ status: "disconnected", accessTokenEnc: null, refreshTokenEnc: null, updatedAt: new Date() }).where(eq(mailConnections.mailboxId, box.id));
    // Keep the conversations. A mailbox with no forwarding address stops being offered for sending.
    await tx.update(mailboxes).set({ provider: "forwarding", isActive: box.inboundAddress ? box.isActive : false, updatedAt: new Date() }).where(eq(mailboxes.id, box.id));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: box.firmId, action: "mailbox.disconnected", entityType: "mailbox", entityId: box.id, summary: `Disconnected ${box.fromAddress}`, ip: ctx.ip }, tx);
  });
}

/* ───────────── tokens ───────────── */

type ConnRow = typeof mailConnections.$inferSelect;
type BoxRow = typeof mailboxes.$inferSelect;

async function readConnection(orgId: string, connectionId: string) {
  return withScope({ orgId, userId: null, firmIds: [], mailSystem: true }, async (tx) => {
    const [row] = await tx.select({ c: mailConnections, m: mailboxes }).from(mailConnections).innerJoin(mailboxes, eq(mailboxes.id, mailConnections.mailboxId)).where(eq(mailConnections.id, connectionId));
    return row ?? null;
  });
}

async function freshView(orgId: string, c: ConnRow, m: BoxRow): Promise<ConnectionView> {
  if (!c.accessTokenEnc || !c.refreshTokenEnc) throw new ProviderAuthError("This mailbox isn't connected. Reconnect it in Settings › Email.");
  let access = decrypt(c.accessTokenEnc);
  if (!c.tokenExpiresAt || c.tokenExpiresAt.getTime() < Date.now() + 120_000) {
    const t: Tokens = await (tokenOverride.refresh ?? refreshTokens)(c.provider as Provider, decrypt(c.refreshTokenEnc));
    access = t.accessToken;
    await withScope({ orgId, userId: null, firmIds: [], mailSystem: true }, (tx) =>
      tx.update(mailConnections).set({ accessTokenEnc: encrypt(t.accessToken), ...(t.refreshToken ? { refreshTokenEnc: encrypt(t.refreshToken) } : {}), tokenExpiresAt: t.expiresAt, updatedAt: new Date() }).where(eq(mailConnections.id, c.id)),
    );
  }
  return { accountEmail: c.accountEmail, mailboxAddress: m.kind === "personal" ? c.accountEmail : m.fromAddress, accessToken: access };
}

async function markFailure(orgId: string, connectionId: string, err: unknown) {
  const auth = err instanceof ProviderAuthError;
  const message = (err instanceof Error ? err.message : "Sync failed").slice(0, 300);
  await withScope({ orgId, userId: null, firmIds: [], mailSystem: true }, (tx) =>
    tx
      .update(mailConnections)
      .set({
        lastError: message, lastSyncAt: new Date(), failureCount: sql`${mailConnections.failureCount} + 1`,
        status: auth ? "needs_reconnect" : sql`case when ${mailConnections.failureCount} + 1 >= 5 then 'error'::mail_connection_status else ${mailConnections.status} end`,
        updatedAt: new Date(),
      })
      .where(eq(mailConnections.id, connectionId)),
  );
}

/* ───────────── syncing ───────────── */

function toIncoming(m: SyncedMessage, live: boolean) {
  return {
    providerId: m.providerId, threadKey: m.threadKey, taggedThreadId: null, internetMessageId: m.internetMessageId, inReplyTo: m.inReplyTo,
    from: m.from, to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, text: m.text, html: m.html, date: m.date, outbound: m.outbound,
    attachments: m.attachments.map((a) => ({ id: a.id, filename: a.filename, contentType: a.contentType, size: a.size, inline: a.inline })),
    authResult: null, untrusted: false, live,
  };
}

async function store(orgId: string, mailbox: BoxRow, msgs: SyncedMessage[], live: (m: SyncedMessage) => boolean) {
  let imported = 0;
  let skipped = 0;
  for (const m of msgs) {
    if (m.isDraft) {
      skipped++;
      continue;
    }
    const r = await withScope(systemScope(orgId, mailbox.firmId), (tx) => fileMail(tx, orgId, mailbox, toIncoming(m, live(m))));
    if (r.status === "stored") imported++;
    else skipped++;
  }
  return { imported, skipped };
}

export type SyncReport = { connectionId: string; mailbox: string; imported: number; skipped: number; importDone: boolean; error: string | null };

/** One bounded run for one connection: continue the history import, then pick up changes. */
export async function syncConnection(orgId: string, connectionId: string, deadline = Date.now() + 40_000): Promise<SyncReport> {
  const row = await readConnection(orgId, connectionId);
  if (!row) throw new NotFoundError("Connection");
  const { c, m } = row;
  const report: SyncReport = { connectionId, mailbox: c.accountEmail, imported: 0, skipped: 0, importDone: c.importState?.phase === "done", error: null };
  if (c.status === "disconnected" || c.status === "needs_reconnect") {
    report.error = c.status === "needs_reconnect" ? "Needs reconnecting" : "Disconnected";
    return report;
  }
  try {
    const view = await freshView(orgId, c, m);
    const adapter = adapterFor(c.provider as Provider);
    let st: MailImportState = c.importState ?? { since: new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString(), phase: "done", imported: 0, skipped: 0, startedAt: new Date().toISOString() };
    let cursor = { ...c.syncCursor };
    const since = new Date(st.since);
    const connectedAt = c.connectedAt.getTime() - 5 * 60_000;

    while (st.phase !== "done" && Date.now() < deadline) {
      const phase = st.phase;
      const page = await adapter.importPage(view, phase, since, st.pageToken ?? null);
      const r = await store(orgId, m, page.messages, (x) => x.date.getTime() >= connectedAt);
      st = { ...st, imported: st.imported + r.imported, skipped: st.skipped + r.skipped, pageToken: page.next };
      report.imported += r.imported;
      report.skipped += r.skipped;
      if (!page.next) {
        if (c.provider === "microsoft") {
          if (phase === "inbox") cursor = { ...cursor, inboxDelta: page.cursor ?? undefined };
          else cursor = { ...cursor, sentDelta: page.cursor ?? undefined };
          st = { ...st, phase: phase === "inbox" ? "sent" : "done", pageToken: null, ...(phase === "sent" ? { finishedAt: new Date().toISOString() } : {}) };
        } else {
          cursor = { ...cursor, historyId: page.cursor ?? undefined };
          st = { ...st, phase: "done", pageToken: null, finishedAt: new Date().toISOString() };
        }
      }
      await saveProgress(orgId, connectionId, st, cursor);
    }

    if (st.phase === "done" && Date.now() < deadline) {
      const changes = await adapter.changes(view, cursor, since);
      const r = await store(orgId, m, changes.messages, (x) => x.date.getTime() >= connectedAt);
      report.imported += r.imported;
      report.skipped += r.skipped;
      cursor = changes.cursor;
    }
    report.importDone = st.phase === "done";
    await withScope({ orgId, userId: null, firmIds: [], mailSystem: true }, (tx) =>
      tx.update(mailConnections).set({ importState: st, syncCursor: cursor, lastSyncAt: new Date(), lastSuccessAt: new Date(), lastError: null, failureCount: 0, status: "connected", updatedAt: new Date() }).where(eq(mailConnections.id, connectionId)),
    );
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Sync failed";
    await markFailure(orgId, connectionId, err);
  }
  return report;
}

async function saveProgress(orgId: string, connectionId: string, st: MailImportState, cursor: ConnRow["syncCursor"]) {
  await withScope({ orgId, userId: null, firmIds: [], mailSystem: true }, (tx) => tx.update(mailConnections).set({ importState: st, syncCursor: cursor, lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(mailConnections.id, connectionId)));
}

/** Scheduled job: sync every connected mailbox that hasn't synced in the last few minutes. */
export async function runDueSyncs(budgetMs = 50_000) {
  const deadline = Date.now() + budgetMs;
  const orgs = await db().execute<{ id: string }>(sql`select id from organisations`);
  const reports: SyncReport[] = [];
  for (const { id: orgId } of orgs.rows) {
    const due = await withScope({ orgId, userId: null, firmIds: [], mailSystem: true }, (tx) =>
      tx
        .select({ id: mailConnections.id })
        .from(mailConnections)
        .where(and(eq(mailConnections.orgId, orgId), or(eq(mailConnections.status, "connected"), eq(mailConnections.status, "error")), or(isNull(mailConnections.lastSyncAt), lt(mailConnections.lastSyncAt, new Date(Date.now() - 3 * 60_000)))))
        .orderBy(asc(mailConnections.lastSyncAt)),
    );
    for (const { id } of due) {
      if (Date.now() > deadline - 5_000) break;
      reports.push(await syncConnection(orgId, id, Math.min(deadline, Date.now() + 30_000)));
    }
  }
  return reports;
}

/** "Sync now" from the inbox or settings. */
export async function syncMailboxNow(ctx: AccessContext, mailboxId: string) {
  const box = (await visibleMailboxes(ctx)).find((b) => b.id === mailboxId);
  if (!box) throw new NotFoundError("Mailbox");
  const [conn] = await withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [] }, (tx) => tx.select({ id: mailConnections.id }).from(mailConnections).where(eq(mailConnections.mailboxId, box.id)));
  if (!conn) throw new ValidationError("This mailbox isn't connected to Microsoft 365 or Gmail.");
  return syncConnection(ctx.orgId, conn.id, Date.now() + 25_000);
}

/* ───────────── sending through the provider ───────────── */

export async function sendThroughProvider(orgId: string, mailboxId: string, msg: OutgoingMessage): Promise<{ ok: true; accepted: SendAccepted } | { ok: false; error: string }> {
  const row = await withScope({ orgId, userId: null, firmIds: [], mailSystem: true }, async (tx) => (await tx.select({ c: mailConnections, m: mailboxes }).from(mailConnections).innerJoin(mailboxes, eq(mailboxes.id, mailConnections.mailboxId)).where(eq(mailConnections.mailboxId, mailboxId)))[0]);
  if (!row || row.c.status === "disconnected") return { ok: false, error: "This mailbox isn't connected. Reconnect it in Settings › Email." };
  if (row.c.status === "needs_reconnect") return { ok: false, error: "This mailbox needs reconnecting before it can send (Settings › Email)." };
  try {
    const view = await freshView(orgId, row.c, row.m);
    const accepted = await adapterFor(row.c.provider as Provider).send(view, msg);
    return { ok: true, accepted };
  } catch (err) {
    if (err instanceof ProviderAuthError) await markFailure(orgId, row.c.id, err);
    return { ok: false, error: (err instanceof Error ? err.message : "Sending failed").slice(0, 300) };
  }
}

/* ───────────── attachments ───────────── */

/** Download an attachment of a received or synced message into the dashboard (cached). */
export async function messageAttachment(ctx: AccessContext, messageId: string, attachmentId: string) {
  if (!z.string().uuid().safeParse(messageId).success || !/^[\w=+/.-]{1,400}$/.test(attachmentId)) throw new NotFoundError("Attachment");
  const msg = await withScope(inboxScope(ctx), async (tx: Tx) => {
    const [m] = await tx.select().from(emailMessages).where(eq(emailMessages.id, messageId));
    return m ?? null;
  });
  if (!msg || !canViewInbox(ctx, msg.firmId)) throw new NotFoundError("Attachment");
  const meta = msg.attachments.find((a) => a.id === attachmentId);
  if (!meta) throw new NotFoundError("Attachment");
  const scope = { ...systemScope(ctx.orgId, msg.firmId) };
  if (meta.fileId) {
    const [f] = await withScope(scope, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.id, meta.fileId!)));
    if (f) return f;
  }
  const source = `att:${msg.id}:${createHash("sha256").update(attachmentId).digest("hex").slice(0, 32)}`;
  const [cached] = await withScope(scope, (tx) => tx.select().from(storedFiles).where(and(eq(storedFiles.source, source), eq(storedFiles.orgId, ctx.orgId))));
  if (cached) return cached;

  let file: { data: Buffer; contentType: string; filename: string } | null = null;
  if (msg.providerId?.startsWith("ms:") || msg.providerId?.startsWith("gm:")) {
    const [thread] = await withScope(scope, (tx) => tx.select({ mailboxId: emailThreads.mailboxId }).from(emailThreads).where(eq(emailThreads.id, msg.threadId)));
    const row = thread?.mailboxId ? await withScope(scope, async (tx) => (await tx.select({ c: mailConnections, m: mailboxes }).from(mailConnections).innerJoin(mailboxes, eq(mailboxes.id, mailConnections.mailboxId)).where(eq(mailConnections.mailboxId, thread.mailboxId!)))[0]) : null;
    if (!row) throw new ValidationError("The mailbox this came from is no longer connected, so the attachment can't be downloaded.");
    const view = await freshView(ctx.orgId, row.c, row.m);
    file = await adapterFor(row.c.provider as Provider).attachment(view, msg.providerId, attachmentId);
  } else if (msg.providerId) {
    file = await resendGetReceivedAttachment(msg.providerId, attachmentId);
  }
  if (!file) throw new ValidationError("This attachment couldn't be downloaded from the provider.");
  if (file.data.length > 25 * 1024 * 1024) throw new ValidationError("This attachment is larger than 25 MB. Open it in the original mailbox.");
  const [saved] = await withScope(scope, (tx) =>
    tx
      .insert(storedFiles)
      .values({ orgId: ctx.orgId, firmId: msg.firmId, filename: safeFilename(meta.filename || file!.filename), contentType: meta.contentType || file!.contentType, size: file!.data.length, sha256: createHash("sha256").update(file!.data).digest("hex"), data: file!.data, source, createdById: ctx.user.id })
      .returning(),
  );
  return saved;
}


/** Connection health for the settings screen (no tokens). */
export async function connectionSummaries(ctx: AccessContext) {
  const boxes = await visibleMailboxes(ctx);
  if (!boxes.length) return new Map<string, { status: string; accountEmail: string; lastSyncAt: Date | null; lastSuccessAt: Date | null; lastError: string | null; importState: MailImportState | null; connectedAt: Date }>();
  const rows = await withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [] }, (tx) =>
    tx
      .select({ mailboxId: mailConnections.mailboxId, status: mailConnections.status, accountEmail: mailConnections.accountEmail, lastSyncAt: mailConnections.lastSyncAt, lastSuccessAt: mailConnections.lastSuccessAt, lastError: mailConnections.lastError, importState: mailConnections.importState, connectedAt: mailConnections.connectedAt })
      .from(mailConnections)
      .where(and(eq(mailConnections.orgId, ctx.orgId))),
  );
  const visible = new Set(boxes.map((b) => b.id));
  return new Map(rows.filter((r) => visible.has(r.mailboxId)).map((r) => [r.mailboxId, r]));
}
