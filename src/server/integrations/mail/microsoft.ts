import "server-only";
import { ProviderAuthError, ProviderError, type ConnectionView, type MailAdapter, type OutgoingMessage, type Page, type SyncedMessage } from "./types";

/**
 * Microsoft 365 via Microsoft Graph. Immutable ids (Prefer: IdType) so a
 * message keeps its id when moved between folders. History and new mail both
 * come from the folder delta queries; the delta link is the sync cursor.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const SELECT = "id,conversationId,internetMessageId,subject,from,sender,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,body,hasAttachments,isDraft,parentFolderId";

type GraphRecipient = { emailAddress?: { address?: string; name?: string } };
type GraphMessage = {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
  isDraft?: boolean;
  "@removed"?: unknown;
  attachments?: { id: string; name?: string; contentType?: string; size?: number; isInline?: boolean }[];
};

export const base = (c: ConnectionView) => (c.mailboxAddress.toLowerCase() === c.accountEmail.toLowerCase() ? `${GRAPH}/me` : `${GRAPH}/users/${encodeURIComponent(c.mailboxAddress)}`);
const msId = (id: string) => `ms:${id}`;
const rawId = (providerId: string) => providerId.replace(/^ms:/, "");

async function graph<T>(c: ConnectionView, url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<{ status: number; body: T }> {
  const res = await fetcher(url.startsWith("http") ? url : `${GRAPH}${url}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${c.accessToken}`,
      Prefer: 'IdType="ImmutableId", outlook.body-content-type="html", odata.maxpagesize=50',
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 401) throw new ProviderAuthError("Microsoft rejected the sign-in. Reconnect this mailbox.");
  if (res.status === 202 || res.status === 204) return { status: res.status, body: {} as T };
  const body = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } }).error;
    if (res.status === 403) throw new ProviderAuthError(`Microsoft refused access (${err?.code ?? 403}). Check the mailbox permissions and reconnect.`);
    throw new ProviderError(`Microsoft ${res.status}: ${err?.message ?? "request failed"}`.slice(0, 300), res.status);
  }
  return { status: res.status, body };
}

const addr = (r: GraphRecipient | undefined) => (r?.emailAddress?.address ?? "").toLowerCase();
const list = (rs: GraphRecipient[] | undefined) => (rs ?? []).map(addr).filter(Boolean);

function stripHtml(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h\d|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normaliseGraph(m: GraphMessage, mailboxAddress: string, folder: "inbox" | "sent" | null): SyncedMessage {
  const from = m.from ?? m.sender;
  const fromEmail = addr(from);
  const html = m.body?.contentType?.toLowerCase() === "html" ? (m.body.content ?? null) : null;
  const text = html ? stripHtml(html) : (m.body?.content ?? null);
  return {
    providerId: msId(m.id),
    threadKey: m.conversationId ?? m.id,
    internetMessageId: m.internetMessageId ?? null,
    inReplyTo: null,
    from: { email: fromEmail, name: from?.emailAddress?.name ?? null },
    to: list(m.toRecipients),
    cc: list(m.ccRecipients),
    bcc: list(m.bccRecipients),
    subject: m.subject ?? "(no subject)",
    text,
    html,
    date: new Date(m.sentDateTime ?? m.receivedDateTime ?? Date.now()),
    outbound: folder === "sent" || fromEmail === mailboxAddress.toLowerCase(),
    isDraft: Boolean(m.isDraft),
    attachments: (m.attachments ?? []).map((a) => ({ id: a.id, filename: a.name ?? "attachment", contentType: a.contentType ?? "application/octet-stream", size: a.size ?? null, inline: Boolean(a.isInline) })),
  };
}

function deltaStart(c: ConnectionView, folder: "inbox" | "sent", since: Date) {
  const f = folder === "inbox" ? "inbox" : "sentitems";
  const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
  return `${base(c)}/mailFolders/${f}/messages/delta?$select=${SELECT}&$filter=${filter}`;
}

type DeltaPage = { value: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };

/** Attachment names are not in the delta payload; fetch them for messages that have any. */
async function withAttachments(c: ConnectionView, msgs: GraphMessage[], fetcher?: typeof fetch) {
  for (const m of msgs) {
    if (!m.hasAttachments || m["@removed"]) continue;
    try {
      const { body } = await graph<{ value: GraphMessage["attachments"] }>(c, `${base(c)}/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,contentType,size,isInline`, {}, fetcher);
      m.attachments = body.value ?? [];
    } catch {
      m.attachments = [];
    }
  }
  return msgs;
}

export function microsoftAdapter(fetcher?: typeof fetch): MailAdapter {
  return {
    async importPage(c, phase, since, pageToken): Promise<Page> {
      const url = pageToken ?? deltaStart(c, phase, since);
      const { body } = await graph<DeltaPage>(c, url, {}, fetcher);
      const live = await withAttachments(c, (body.value ?? []).filter((m) => !m["@removed"]), fetcher);
      return { messages: live.map((m) => normaliseGraph(m, c.mailboxAddress, phase)), next: body["@odata.nextLink"] ?? null, cursor: body["@odata.deltaLink"] ?? null };
    },

    async changes(c, cursor, since) {
      const out: SyncedMessage[] = [];
      const next = { ...cursor };
      let more = false;
      for (const folder of ["inbox", "sent"] as const) {
        const key = folder === "inbox" ? "inboxDelta" : "sentDelta";
        let url: string | undefined = cursor[key] ?? deltaStart(c, folder, since);
        for (let pages = 0; url && pages < 5; pages++) {
          const { body }: { body: DeltaPage } = await graph<DeltaPage>(c, url, {}, fetcher);
          const live = await withAttachments(c, (body.value ?? []).filter((m) => !m["@removed"]), fetcher);
          out.push(...live.map((m) => normaliseGraph(m, c.mailboxAddress, folder)));
          if (body["@odata.deltaLink"]) {
            next[key] = body["@odata.deltaLink"];
            url = undefined;
          } else {
            url = body["@odata.nextLink"];
            if (url && pages === 4) {
              next[key] = url; // resume from here next run
              more = true;
            }
          }
        }
      }
      return { messages: out, cursor: next, more };
    },

    async send(c, msg: OutgoingMessage) {
      const recipients = (xs: string[]) => xs.map((address) => ({ emailAddress: { address } }));
      let draftId: string;
      if (msg.replyTo) {
        const action = msg.replyTo.mode === "forward" ? "createForward" : msg.replyTo.mode === "reply_all" ? "createReplyAll" : "createReply";
        const { body } = await graph<GraphMessage>(c, `${base(c)}/messages/${encodeURIComponent(rawId(msg.replyTo.providerId))}/${action}`, { method: "POST", body: "{}" }, fetcher);
        draftId = body.id;
        await graph(c, `${base(c)}/messages/${encodeURIComponent(draftId)}`, {
          method: "PATCH",
          body: JSON.stringify({ subject: msg.subject, body: { contentType: "HTML", content: msg.html }, toRecipients: recipients(msg.to), ccRecipients: recipients(msg.cc), bccRecipients: recipients(msg.bcc) }),
        }, fetcher);
      } else {
        const { body } = await graph<GraphMessage>(c, `${base(c)}/messages`, {
          method: "POST",
          body: JSON.stringify({ subject: msg.subject, body: { contentType: "HTML", content: msg.html }, toRecipients: recipients(msg.to), ccRecipients: recipients(msg.cc), bccRecipients: recipients(msg.bcc) }),
        }, fetcher);
        draftId = body.id;
      }
      for (const a of msg.attachments) {
        await graph(c, `${base(c)}/messages/${encodeURIComponent(draftId)}/attachments`, {
          method: "POST",
          body: JSON.stringify({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.contentType, contentBytes: a.data.toString("base64") }),
        }, fetcher);
      }
      const { body: draft } = await graph<GraphMessage>(c, `${base(c)}/messages/${encodeURIComponent(draftId)}?$select=id,conversationId,internetMessageId`, {}, fetcher);
      const sent = await graph(c, `${base(c)}/messages/${encodeURIComponent(draftId)}/send`, { method: "POST" }, fetcher);
      if (sent.status !== 202) throw new ProviderError(`Microsoft did not accept the message (${sent.status})`, sent.status);
      return { providerId: msId(draftId), threadKey: draft.conversationId ?? null, internetMessageId: draft.internetMessageId ?? null };
    },

    async attachment(c, providerMessageId, attachmentId) {
      const { body } = await graph<{ name?: string; contentType?: string; contentBytes?: string }>(c, `${base(c)}/messages/${encodeURIComponent(rawId(providerMessageId))}/attachments/${encodeURIComponent(attachmentId)}`, {}, fetcher);
      if (!body.contentBytes) throw new ProviderError("This attachment can't be downloaded (it may be a linked item).");
      return { data: Buffer.from(body.contentBytes, "base64"), contentType: body.contentType ?? "application/octet-stream", filename: body.name ?? "attachment" };
    },
  };
}
