/**
 * Common shapes for provider mailboxes (Microsoft 365, Gmail). Each provider
 * adapter turns its own API into these, so the sync engine and the inbox
 * don't need to know which provider a mailbox uses.
 */

export type Provider = "microsoft" | "google";

export type Address = { email: string; name: string | null };

export type ProviderAttachment = { id: string; filename: string; contentType: string; size: number | null; inline: boolean };

/** One message as found in the provider mailbox. */
export type SyncedMessage = {
  /** Provider message id, prefixed: "ms:…" or "gm:…". Stable across folder moves. */
  providerId: string;
  /** Provider conversation id (Microsoft conversationId, Gmail threadId). */
  threadKey: string;
  internetMessageId: string | null;
  inReplyTo: string | null;
  from: Address;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string | null;
  html: string | null;
  date: Date;
  /** True when it was sent from this mailbox (Sent folder / SENT label). */
  outbound: boolean;
  isDraft: boolean;
  attachments: ProviderAttachment[];
};

export type Page = { messages: SyncedMessage[]; next: string | null; cursor: string | null };

/** What we ask the provider to send. */
export type OutgoingMessage = {
  from: Address;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; contentType: string; data: Buffer }[];
  /** Reply / forward: the provider message being answered. */
  replyTo?: { providerId: string; internetMessageId: string | null; threadKey: string | null; mode: "reply" | "reply_all" | "forward" } | null;
};

/** The provider accepted the message. Acceptance is not delivery. */
export type SendAccepted = { providerId: string; threadKey: string | null; internetMessageId: string | null };

export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date; scopes: string | null };

export class ProviderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderAuthError";
  }
}

export class ProviderError extends Error {
  constructor(message: string, public readonly status: number | null = null) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Connection details the adapters need (decrypted access token, cursors). */
export type ConnectionView = {
  accountEmail: string;
  /** The address of the mailbox being read (differs from accountEmail for a shared mailbox). */
  mailboxAddress: string;
  accessToken: string;
};

export interface MailAdapter {
  /** History import, one page at a time. `phase` lets a provider walk folders in turn. */
  importPage(c: ConnectionView, phase: "inbox" | "sent", since: Date, pageToken: string | null): Promise<Page>;
  /** New and changed messages since the stored cursor. */
  changes(c: ConnectionView, cursor: { inboxDelta?: string; sentDelta?: string; historyId?: string }, since: Date): Promise<{ messages: SyncedMessage[]; cursor: { inboxDelta?: string; sentDelta?: string; historyId?: string }; more: boolean }>;
  send(c: ConnectionView, msg: OutgoingMessage): Promise<SendAccepted>;
  attachment(c: ConnectionView, providerMessageId: string, attachmentId: string): Promise<{ data: Buffer; contentType: string; filename: string }>;
}
