import "server-only";
import { buildMime } from "./mime";
import { ProviderAuthError, ProviderError, type ConnectionView, type MailAdapter, type SyncedMessage } from "./types";

/**
 * Gmail / Google Workspace via the Gmail API. History import pages through
 * messages.list; new mail comes from history.list with the stored historyId.
 */

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const gmId = (id: string) => `gm:${id}`;
const rawId = (providerId: string) => providerId.replace(/^gm:/, "");

class HistoryExpired extends Error {}

async function gmail<T>(c: ConnectionView, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const res = await fetcher(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${c.accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 401) throw new ProviderAuthError("Google rejected the sign-in. Reconnect this mailbox.");
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (res.status === 404 && path.startsWith("/history")) throw new HistoryExpired();
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } }).error?.message ?? "request failed";
    if (res.status === 403) throw new ProviderAuthError(`Google refused access: ${msg}`.slice(0, 300));
    throw new ProviderError(`Gmail ${res.status}: ${msg}`.slice(0, 300), res.status);
  }
  return body;
}

type Part = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[] };
type GmailMessage = { id: string; threadId: string; labelIds?: string[]; internalDate?: string; payload?: Part };

const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

export function parseAddressList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((p) => (p.match(/<([^>]+)>/)?.[1] ?? p).trim().toLowerCase())
    .filter((p) => p.includes("@"));
}

function decodeWords(v: string) {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, _cs, enc: string, data: string) =>
    enc.toUpperCase() === "B" ? Buffer.from(data, "base64").toString("utf8") : data.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))),
  );
}

export function normaliseGmail(m: GmailMessage, mailboxAddress: string): SyncedMessage {
  const headers = new Map((m.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  let text: string | null = null;
  let html: string | null = null;
  const attachments: SyncedMessage["attachments"] = [];
  const walk = (p: Part) => {
    if (p.filename && p.body?.attachmentId) {
      const disp = (p.headers ?? []).find((h) => h.name.toLowerCase() === "content-disposition")?.value ?? "";
      attachments.push({ id: p.body.attachmentId, filename: p.filename, contentType: p.mimeType ?? "application/octet-stream", size: p.body.size ?? null, inline: /inline/i.test(disp) });
    } else if (p.mimeType === "text/plain" && p.body?.data && text === null) text = b64(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data && html === null) html = b64(p.body.data);
    for (const c of p.parts ?? []) walk(c);
  };
  if (m.payload) walk(m.payload);
  const fromRaw = headers.get("from") ?? "";
  const fromEmail = parseAddressList(fromRaw)[0] ?? "";
  const fromName = decodeWords(fromRaw.replace(/<[^>]+>/, "").replace(/"/g, "").trim()) || null;
  const labels = m.labelIds ?? [];
  return {
    providerId: gmId(m.id),
    threadKey: m.threadId,
    internetMessageId: headers.get("message-id") ?? null,
    inReplyTo: headers.get("in-reply-to") ?? null,
    from: { email: fromEmail, name: fromName && fromName !== fromEmail ? fromName : null },
    to: parseAddressList(headers.get("to")),
    cc: parseAddressList(headers.get("cc")),
    bcc: parseAddressList(headers.get("bcc")),
    subject: decodeWords(headers.get("subject") ?? "(no subject)"),
    text,
    html,
    date: new Date(Number(m.internalDate ?? Date.now())),
    outbound: labels.includes("SENT") || fromEmail === mailboxAddress.toLowerCase(),
    isDraft: labels.includes("DRAFT"),
    attachments,
  };
}

async function getFull(c: ConnectionView, id: string, fetcher?: typeof fetch) {
  return gmail<GmailMessage>(c, `/messages/${encodeURIComponent(id)}?format=full`, {}, fetcher);
}

export function googleAdapter(fetcher?: typeof fetch): MailAdapter {
  return {
    async importPage(c, _phase, since, pageToken) {
      const q = `after:${Math.floor(since.getTime() / 1000)} -in:chats -in:spam -in:trash -in:drafts`;
      const page = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(c, `/messages?maxResults=40&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, {}, fetcher);
      const messages: SyncedMessage[] = [];
      for (const { id } of page.messages ?? []) messages.push(normaliseGmail(await getFull(c, id, fetcher), c.mailboxAddress));
      // Gmail walks every folder at once; there is no separate "sent" pass.
      let cursor: string | null = null;
      if (!page.nextPageToken) cursor = (await gmail<{ historyId: string }>(c, "/profile", {}, fetcher)).historyId;
      return { messages, next: page.nextPageToken ?? null, cursor };
    },

    async changes(c, cursor, since) {
      if (!cursor.historyId) {
        const p = await gmail<{ historyId: string }>(c, "/profile", {}, fetcher);
        const first = await this.importPage(c, "inbox", since, null);
        return { messages: first.messages, cursor: { historyId: p.historyId }, more: Boolean(first.next) };
      }
      const ids = new Set<string>();
      let historyId = cursor.historyId;
      let pageToken: string | undefined;
      try {
        for (let pages = 0; pages < 5; pages++) {
          const h = await gmail<{ history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; historyId: string; nextPageToken?: string }>(
            c,
            `/history?startHistoryId=${encodeURIComponent(cursor.historyId)}&historyTypes=messageAdded&maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
            {},
            fetcher,
          );
          for (const e of h.history ?? []) for (const a of e.messagesAdded ?? []) if (!(a.message.labelIds ?? []).some((l) => l === "DRAFT" || l === "SPAM" || l === "CHAT")) ids.add(a.message.id);
          historyId = h.historyId;
          pageToken = h.nextPageToken;
          if (!pageToken) break;
        }
      } catch (e) {
        if (!(e instanceof HistoryExpired)) throw e;
        // History older than Google keeps: reconcile the recent window instead.
        const p = await gmail<{ historyId: string }>(c, "/profile", {}, fetcher);
        const first = await this.importPage(c, "inbox", new Date(Math.max(since.getTime(), Date.now() - 7 * 864e5)), null);
        return { messages: first.messages, cursor: { historyId: p.historyId }, more: Boolean(first.next) };
      }
      const messages: SyncedMessage[] = [];
      for (const id of ids) {
        try {
          messages.push(normaliseGmail(await getFull(c, id, fetcher), c.mailboxAddress));
        } catch (e) {
          if (!(e instanceof ProviderError && e.status === 404)) throw e; // deleted since: skip
        }
      }
      return { messages, cursor: { historyId }, more: Boolean(pageToken) };
    },

    async send(c, msg) {
      const raw = buildMime({
        from: msg.from, to: msg.to, cc: msg.cc, bcc: msg.bcc, subject: msg.subject, text: msg.text, html: msg.html, attachments: msg.attachments,
        inReplyTo: msg.replyTo && msg.replyTo.mode !== "forward" ? msg.replyTo.internetMessageId : null,
      });
      const body: { raw: string; threadId?: string } = { raw: Buffer.from(raw, "utf8").toString("base64url") };
      if (msg.replyTo?.threadKey && msg.replyTo.mode !== "forward") body.threadId = msg.replyTo.threadKey;
      const sent = await gmail<{ id: string; threadId: string }>(c, "/messages/send", { method: "POST", body: JSON.stringify(body) }, fetcher);
      if (!sent.id) throw new ProviderError("Gmail did not accept the message");
      let internetMessageId: string | null = null;
      try {
        const meta = await gmail<GmailMessage>(c, `/messages/${encodeURIComponent(sent.id)}?format=metadata&metadataHeaders=Message-Id`, {}, fetcher);
        internetMessageId = meta.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id")?.value ?? null;
      } catch {
        /* accepted anyway; the id arrives with the next sync */
      }
      return { providerId: gmId(sent.id), threadKey: sent.threadId, internetMessageId };
    },

    async attachment(c, providerMessageId, attachmentId) {
      const full = await getFull(c, rawId(providerMessageId), fetcher);
      const meta = normaliseGmail(full, c.mailboxAddress).attachments.find((a) => a.id === attachmentId);
      const a = await gmail<{ data: string }>(c, `/messages/${encodeURIComponent(rawId(providerMessageId))}/attachments/${encodeURIComponent(attachmentId)}`, {}, fetcher);
      return { data: Buffer.from(a.data.replace(/-/g, "+").replace(/_/g, "/"), "base64"), contentType: meta?.contentType ?? "application/octet-stream", filename: meta?.filename ?? "attachment" };
    },
  };
}
