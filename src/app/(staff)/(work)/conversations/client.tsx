"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { sendReplyAction } from "./actions";

/** Re-reads the page from the server every few seconds while the tab is visible, so new messages appear. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/** Search by name, email, phone, matter or proposal reference; keeps the other filters. */
export function SearchBox({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(defaultValue);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const p = new URLSearchParams(params.toString());
        if (q.trim()) p.set("q", q.trim());
        else p.delete("q");
        p.delete("c");
        router.push(`${pathname}${p.size ? `?${p}` : ""}`);
      }}
    >
      <label htmlFor="conv-search" className="sr-only">Search conversations</label>
      <Input id="conv-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone or reference" />
    </form>
  );
}

type Channel = "whatsapp" | "email" | "webchat";

/**
 * Reply to the client. The engine sends it on the chosen channel; WhatsApp
 * outside the 24-hour window sends the approved reopen message instead and
 * holds the text until the client answers.
 */
export function ReplyBox({ leadId, channels, defaultChannel, whatsappOpen }: { leadId: string; channels: Channel[]; defaultChannel: Channel; whatsappOpen: boolean }) {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>(defaultChannel);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reopen = channel === "whatsapp" && !whatsappOpen;
  const label: Record<Channel, string> = { whatsapp: "WhatsApp", email: "Email", webchat: "Website chat" };
  const send = () => {
    if (!body.trim() && !reopen) return;
    setMsg(null);
    start(async () => {
      const r = await sendReplyAction(leadId, { channel, body, subject: channel === "email" ? subject : undefined, reopen });
      if (r.ok) {
        setBody("");
        setSubject("");
        setMsg(reopen ? "Reopen request queued. Your message goes out when the client replies." : "Queued. It shows as sent below once the engine confirms.");
        router.refresh();
      } else setMsg(r.error);
    });
  };
  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="reply-channel" className="text-xs font-medium text-muted">Reply by</label>
        <Select id="reply-channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className="h-8 w-auto py-0 text-[13px]">
          {channels.map((c) => <option key={c} value={c}>{label[c]}</option>)}
        </Select>
        {channel === "email" ? (
          <>
            <label htmlFor="reply-subject" className="sr-only">Subject</label>
            <Input id="reply-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (optional)" className="h-8 min-w-48 flex-1 text-[13px]" />
          </>
        ) : null}
      </div>
      <label htmlFor="reply-body" className="sr-only">Message</label>
      <Textarea id="reply-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder={reopen ? "Optional: your message, sent once the client replies" : "Write to the client"}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-xs text-muted" role="status">{msg ?? (channel === "email" ? "Sent from the Hub in its letterhead, starting \"Dear …\". Replies come back here." : "The engine stays quiet on this client for 2 hours after you reply.")}</span>
        <Button type="submit" disabled={pending || (!body.trim() && !reopen)}>{pending ? "Sending…" : reopen ? "Send reopen request" : "Send"}</Button>
      </div>
    </form>
  );
}
