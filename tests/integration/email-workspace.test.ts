import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withScope } from "../../src/server/db/client";
import * as s from "../../src/server/db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../src/server/errors";
import { signState } from "../../src/server/integrations/mail/oauth";
import { ProviderAuthError, type MailAdapter, type OutgoingMessage, type SyncedMessage } from "../../src/server/integrations/mail/types";
import { createLead } from "../../src/server/modules/crm/leads";
import { visibleMailboxes } from "../../src/server/modules/email/access";
import { uploadAttachment } from "../../src/server/modules/email/files";
import {
  addNote,
  assignConversation,
  getConversation,
  listInbox,
  listMyDrafts,
  previewMessage,
  saveDraft,
  saveTemplate,
  sendMessage,
} from "../../src/server/modules/email/mail";
import { saveSignature } from "../../src/server/modules/email/signatures";
import { __setMailTestDoubles, completeConnect, disconnectMailbox, syncConnection } from "../../src/server/modules/email/sync";
import { firmId, lead, makeUser, owner, resetDatabase } from "../support/fixtures";
import type { AccessContext } from "../../src/server/access/context";

/* A fake Microsoft mailbox: history, new mail, and what was sent. */
function fakeMailbox(account: string) {
  const history: SyncedMessage[] = [];
  const incoming: SyncedMessage[] = [];
  const sent: OutgoingMessage[] = [];
  let n = 0;
  let failNextSend: Error | null = null;
  const msg = (over: Partial<SyncedMessage>): SyncedMessage => {
    n++;
    return {
      providerId: `ms:m${n}`, threadKey: `conv-${n}`, internetMessageId: `<m${n}@mail.example>`, inReplyTo: null,
      from: { email: "client@test.example", name: "Client Person" }, to: [account], cc: [], bcc: [], subject: `Subject ${n}`,
      text: `Body ${n}`, html: `<p>Body ${n}</p>`, date: new Date(), outbound: false, isDraft: false, attachments: [], ...over,
    };
  };
  const adapter: MailAdapter = {
    async importPage(_c, phase, _since, token) {
      if (phase === "sent") return { messages: [], next: null, cursor: "delta-sent-1" };
      if (!token) return { messages: history.slice(0, 2), next: history.length > 2 ? "page2" : null, cursor: history.length > 2 ? null : "delta-inbox-1" };
      return { messages: history.slice(2), next: null, cursor: "delta-inbox-1" };
    },
    async changes(_c, cursor) {
      const out = incoming.splice(0);
      return { messages: out, cursor: { ...cursor, inboxDelta: "delta-inbox-2" }, more: false };
    },
    async send(_c, m) {
      if (failNextSend) {
        const e = failNextSend;
        failNextSend = null;
        throw e;
      }
      sent.push(m);
      n++;
      return { providerId: `ms:sent${n}`, threadKey: m.replyTo?.threadKey ?? `conv-out-${n}`, internetMessageId: `<sent${n}@mail.example>` };
    },
    async attachment() {
      return { data: Buffer.from("PDF"), contentType: "application/pdf", filename: "passport.pdf" };
    },
  };
  return { adapter, history, incoming, sent, msg, failSend: (e: Error) => (failNextSend = e) };
}

async function connect(ctx: AccessContext, opts: { mailboxId?: string | null; firm: string | null; kind?: "shared" | "personal"; account: string }) {
  const { state, nonce } = signState({ mailboxId: opts.mailboxId ?? null, userId: ctx.user.id, provider: "microsoft", firmId: opts.firm, kind: opts.kind ?? "personal" });
  return completeConnect(ctx, state, "code", nonce);
}

const tokens = {
  exchange: async () => ({ accessToken: "at", refreshToken: "rt", expiresAt: new Date(Date.now() + 3600_000), scopes: "Mail.ReadWrite" }),
  refresh: async () => ({ accessToken: "at2", refreshToken: "rt2", expiresAt: new Date(Date.now() + 3600_000), scopes: null }),
};

describe("email workspace", () => {
  beforeEach(resetDatabase);
  afterEach(() => __setMailTestDoubles({}, {}));

  it("imports a connected mailbox's history once, threads it, links it, and keeps it private to its owner", async () => {
    const veritas = await firmId("veritas");
    const owen = await makeUser({ firms: { veritas: "firm_admin" } });
    const colleague = await makeUser({ firms: { veritas: "firm_admin" } });
    const { lead: l } = await createLead(owen, veritas, lead({ email: "client@test.example" }));
    const fake = fakeMailbox("owen@veritas.example");
    __setMailTestDoubles({ microsoft: fake.adapter }, { ...tokens, profile: async () => ({ email: "owen@veritas.example", name: "Owen" }) });
    fake.history.push(fake.msg({ threadKey: "c1", subject: "Spouse visa", date: new Date(Date.now() - 86400_000 * 3) }));
    fake.history.push(fake.msg({ threadKey: "c1", subject: "Re: Spouse visa", date: new Date(Date.now() - 86400_000 * 2) }));
    fake.history.push(fake.msg({ threadKey: "c2", subject: "Old other", from: { email: "someone@else.example", name: null }, date: new Date(Date.now() - 86400_000) }));

    const { mailbox, connectionId } = await connect(owen, { firm: veritas, account: "owen@veritas.example" });
    expect(mailbox.kind).toBe("personal");
    const r1 = await syncConnection(owen.orgId, connectionId);
    expect(r1).toMatchObject({ imported: 3, importDone: true, error: null });
    const again = await syncConnection(owen.orgId, connectionId);
    expect(again.imported).toBe(0);

    const mine = await listInbox(owen, { mailboxId: mailbox.id, status: "all" });
    expect(mine).toHaveLength(2);
    const spouse = mine.find((t) => t.subject === "Spouse visa")!;
    expect(spouse.messageCount).toBe(2);
    expect(spouse.leadId).toBe(l.id);
    expect(spouse.unread).toBe(false); // history isn't "new"

    // A colleague in the same practice can't see a personal mailbox, in the app or in the database.
    expect((await visibleMailboxes(colleague)).some((b) => b.id === mailbox.id)).toBe(false);
    expect(await listInbox(colleague, { status: "all" })).toHaveLength(0);
    const raw = await withScope({ orgId: colleague.orgId, userId: colleague.user.id, firmIds: [veritas] }, (tx) => tx.execute(sql`select id from email_threads`));
    expect(raw.rows).toHaveLength(0);
    await expect(getConversation(colleague, spouse.id)).rejects.toBeInstanceOf(NotFoundError);

    // New mail after connecting arrives as unread.
    fake.incoming.push(fake.msg({ threadKey: "c1", subject: "Re: Spouse visa", date: new Date() }));
    await syncConnection(owen.orgId, connectionId);
    const after = (await listInbox(owen, { mailboxId: mailbox.id })).find((t) => t.id === spouse.id)!;
    expect(after.unread).toBe(true);
    expect(after.messageCount).toBe(3);
  });

  it("replies through the provider in the same conversation, with CC, BCC, attachment and one signature; sent only once accepted", async () => {
    const veritas = await firmId("veritas");
    const owen = await makeUser({ name: "Owen Magocha", firms: { veritas: "firm_admin" } });
    const fake = fakeMailbox("owen@veritas.example");
    __setMailTestDoubles({ microsoft: fake.adapter }, { ...tokens, profile: async () => ({ email: "owen@veritas.example", name: "Owen Magocha" }) });
    fake.history.push(fake.msg({ threadKey: "c9", subject: "Work visa", internetMessageId: "<orig@mail.example>" }));
    const { mailbox, connectionId } = await connect(owen, { firm: veritas, account: "owen@veritas.example" });
    await syncConnection(owen.orgId, connectionId);
    await saveSignature(owen, veritas, "mine", { fullName: "Owen Magocha", role: "Founder", phone: "+27 12 140 0194", showLogo: true });
    const [thread] = await listInbox(owen, { mailboxId: mailbox.id });
    const file = await uploadAttachment(owen, veritas, { name: "checklist.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 test") });

    const out = await sendMessage(owen, { mailboxId: mailbox.id, threadId: thread.id, mode: "reply_all", to: ["client@test.example"], cc: "partner@test.example", bcc: ["file@veritas.example"], body: "Thanks. Checklist attached.", format: "plain", attachmentIds: [file.id] });
    expect(out.status).toBe("sent");
    expect(fake.sent).toHaveLength(1);
    const s0 = fake.sent[0];
    expect(s0.replyTo).toMatchObject({ mode: "reply_all", threadKey: "c9" });
    expect(s0.cc).toEqual(["partner@test.example"]);
    expect(s0.bcc).toEqual(["file@veritas.example"]);
    expect(s0.attachments[0].filename).toBe("checklist.pdf");
    expect(s0.html.match(/data-gih-signature/g)).toHaveLength(1);
    expect(s0.subject).toBe("Re: Work visa");

    const conv = await getConversation(owen, thread.id);
    const last = conv.messages.at(-1)!;
    expect(last).toMatchObject({ status: "sent", via: "microsoft", direction: "outbound" });
    expect(last.acceptedAt).not.toBeNull();
    // The sync later sees the same message in Sent Items and doesn't duplicate it.
    fake.incoming.push({ ...fake.msg({ outbound: true, threadKey: "c9" }), providerId: last.providerId! });
    await syncConnection(owen.orgId, connectionId);
    expect((await getConversation(owen, thread.id)).messages).toHaveLength(2);

    // A provider refusal is recorded as failed, not sent.
    fake.failSend(new Error("Microsoft 503: try later"));
    const failed = await sendMessage(owen, { mailboxId: mailbox.id, threadId: thread.id, mode: "reply", to: ["client@test.example"], body: "Second", format: "plain" });
    expect(failed).toMatchObject({ status: "failed" });
    expect((await getConversation(owen, thread.id)).messages.at(-1)!.status).toBe("failed");

    // Expired sign-in marks the connection for reconnection.
    fake.failSend(new ProviderAuthError("Microsoft rejected the sign-in."));
    await sendMessage(owen, { mailboxId: mailbox.id, threadId: thread.id, mode: "reply", to: ["client@test.example"], body: "Third", format: "plain" });
    const [conn] = await owner.select().from(s.mailConnections).where(eq(s.mailConnections.id, connectionId));
    expect(conn.status).toBe("needs_reconnect");
    expect(conn.accessTokenEnc).not.toContain("at"); // stored encrypted
  });

  it("keeps internal notes off outgoing mail, assigns within the inbox, and keeps drafts private", async () => {
    const veritas = await firmId("veritas");
    const a = await makeUser({ firms: { veritas: "firm_admin" } });
    const b = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const mimshacAdmin = await makeUser({ firms: { mimshac: "firm_admin" } });
    const { lead: l } = await createLead(a, veritas, lead({ email: "thandi@test.example" }));
    const [shared] = (await visibleMailboxes(a, { sendable: true })).filter((m) => m.firmId === veritas);
    const sent = await sendMessage(a, { mailboxId: shared.id, leadId: l.id, subject: "Your documents", body: "Please send your passport." });
    await addNote(a, sent.threadId, "Client prefers WhatsApp. Don't mention fees yet.");
    const conv = await getConversation(b, sent.threadId);
    expect(conv.notes).toHaveLength(1);
    expect(conv.messages.every((m) => !(m.htmlBody ?? "").includes("Don't mention fees"))).toBe(true);

    await assignConversation(a, sent.threadId, b.user.id);
    expect((await listInbox(b, { assignee: "me" })).map((t) => t.id)).toContain(sent.threadId);
    await expect(assignConversation(a, sent.threadId, mimshacAdmin.user.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(addNote(mimshacAdmin, sent.threadId, "x")).rejects.toBeInstanceOf(NotFoundError);

    const d = await saveDraft(a, { mailboxId: shared.id, to: "thandi@test.example", subject: "Draft", body: "Half written" });
    expect((await listMyDrafts(a)).map((x) => x.d.id)).toContain(d.id);
    expect(await listMyDrafts(b)).toHaveLength(0);
  });

  it("renders an imported HTML template with editable sections and blocks sending until fields are complete", async () => {
    const veritas = await firmId("veritas");
    const admin = await makeUser({ firms: { veritas: "firm_admin" } });
    const { lead: l } = await createLead(admin, veritas, lead({ email: "thandi@test.example" }));
    const t = await saveTemplate(admin, { kind: "firm", firmId: veritas }, null, {
      name: "Proposal delivery", category: "Proposal delivery", subject: "Your {{service}} proposal ({{reference}})", format: "html",
      html: `<html><body><table><tr><td><p>Dear {{first_name}},</p><p>{{edit:advice}}</p><a href="{{payment_link}}">Pay</a><script>alert(1)</script><img src="x" onerror="alert(2)"></td></tr></table>{{signature}}</body></html>`,
      slots: [{ key: "advice", label: "Our advice", default: "", multiline: true }],
    });
    expect(t.html).not.toContain("<script>");
    expect(t.html).not.toContain("onerror");
    await expect(saveTemplate(admin, { kind: "firm", firmId: veritas }, null, { name: "Bad", subject: "Hi {{nickname}}", format: "html", html: "<p>{{edit:x}}</p>", slots: [] })).rejects.toBeInstanceOf(ValidationError);

    const [shared] = (await visibleMailboxes(admin, { sendable: true })).filter((m) => m.firmId === veritas);
    const pre = await previewMessage(admin, { mailboxId: shared.id, leadId: l.id, templateId: t.id });
    expect(pre.missingFields).toEqual(expect.arrayContaining(["service", "payment_link"]));
    expect(pre.emptySlots).toEqual(["advice"]);
    await expect(sendMessage(admin, { mailboxId: shared.id, leadId: l.id, templateId: t.id })).rejects.toBeInstanceOf(ValidationError);

    const ok = await previewMessage(admin, { mailboxId: shared.id, leadId: l.id, templateId: t.id, slots: { advice: "We recommend a spouse visa.\n\nSee below." }, fields: { service: "Spouse visa", payment_link: "https://pay.example.com/abc" } });
    expect(ok.missingFields).toEqual([]);
    expect(ok.subject).toBe(`Your Spouse visa proposal (${l.ref})`);
    expect(ok.html).toMatch(/We recommend a spouse visa\.<br \/?><br \/?>See below\./);
    expect(ok.html).toContain('href="https://pay.example.com/abc"');
    expect(ok.text).toContain("Dear Thandi");
    // A merged value can't smuggle in a script link.
    const evil = await previewMessage(admin, { mailboxId: shared.id, leadId: l.id, templateId: t.id, slots: { advice: "x" }, fields: { service: "s", payment_link: "javascript:alert(1)" } });
    expect(evil.html).not.toContain("javascript:");
  });

  it("refuses mailboxes, conversations and attachments from another practice", async () => {
    const veritas = await firmId("veritas");
    const mimshac = await firmId("mimshac");
    const v = await makeUser({ firms: { veritas: "firm_admin" } });
    const m = await makeUser({ firms: { mimshac: "firm_admin" } });
    const [vBox] = (await visibleMailboxes(v, { sendable: true })).filter((x) => x.firmId === veritas);
    await expect(sendMessage(m, { mailboxId: vBox.id, to: "a@test.example", subject: "x", body: "y" })).rejects.toBeInstanceOf(ValidationError);
    const vFile = await uploadAttachment(v, veritas, { name: "a.pdf", type: "application/pdf", data: Buffer.from("x") });
    const [mBox] = (await visibleMailboxes(m, { sendable: true })).filter((x) => x.firmId === mimshac);
    await expect(sendMessage(m, { mailboxId: mBox.id, to: "a@test.example", subject: "x", body: "y", attachmentIds: [vFile.id] })).rejects.toBeInstanceOf(ValidationError);
    await expect(uploadAttachment(m, veritas, { name: "a.pdf", type: "application/pdf", data: Buffer.from("x") })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("disconnecting keeps history and stops sending", async () => {
    const veritas = await firmId("veritas");
    const owen = await makeUser({ firms: { veritas: "firm_admin" } });
    const fake = fakeMailbox("owen@veritas.example");
    __setMailTestDoubles({ microsoft: fake.adapter }, { ...tokens, profile: async () => ({ email: "owen@veritas.example", name: "Owen" }) });
    fake.history.push(fake.msg({}));
    const { mailbox, connectionId } = await connect(owen, { firm: veritas, account: "owen@veritas.example" });
    await syncConnection(owen.orgId, connectionId);
    await disconnectMailbox(owen, mailbox.id);
    expect(await listInbox(owen, { mailboxId: mailbox.id, status: "all" })).toHaveLength(1);
    expect((await visibleMailboxes(owen, { sendable: true })).some((b) => b.id === mailbox.id)).toBe(false);
  });
});
