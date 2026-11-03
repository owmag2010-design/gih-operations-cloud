"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PortalView } from "@/server/modules/portal/client";
import { sendMessageAction, signOutAction, type PortalFormState } from "./actions";

/* eslint-disable @next/next/no-img-element */

type Tab = "overview" | "journey" | "documents" | "messages" | "team";

/** What each standard stage means for the client. Stages a practice adds itself show their name only. */
const STAGE_TEXT: Record<string, { what: string; you: string }> = {
  opening: { what: "Your file is opened and your team reviews your situation.", you: "Read your welcome pack and checklist." },
  documents: { what: "We collect and check the documents your application needs.", you: "Upload everything on your checklist." },
  preparation: { what: "Your team drafts the application forms, cover letter and supporting statements.", you: "Answer any questions your team sends you." },
  review: { what: "A second person reviews the complete file before it goes in.", you: "Nothing, unless we ask you to confirm details." },
  submission: { what: "Your application is lodged and you receive a receipt and reference.", you: "Attend your appointment with your original documents." },
  follow_up: { what: "We follow up with the authorities while the application is processed.", you: "Tell us at once about any letters or calls you receive." },
  outcome: { what: "A decision has been made and we explain what it means for you.", you: "Collect your passport or documents when told." },
};

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const UPLOAD_MESSAGES: Record<string, string> = {
  ok: "Uploaded. Your team has been told and will check it.",
  too_large: "That file is over 15 MB. Please send a smaller scan or photo.",
  wrong_type: "Please upload a PDF, a photo (JPEG, PNG, HEIC) or a Word document.",
  too_many: "You've uploaded a lot in the last hour. Please wait a little.",
  signed_out: "Your session has ended. Please sign in again.",
  invalid: "That file couldn't be read. Please try again.",
  forbidden: "That upload wasn't allowed. Please reload the page.",
};

export function PortalApp({ token, view }: { token: string; view: PortalView }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [openStage, setOpenStage] = useState<string | null>(view.matter.stageId);
  const [filter, setFilter] = useState<"all" | "needed" | "received">("all");
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [msgState, sendMsg, sendingMsg] = useActionState<PortalFormState, FormData>(sendMessageAction.bind(null, token), null);
  const formRef = useRef<HTMLFormElement>(null);
  const tabsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (msgState?.ok) formRef.current?.reset();
  }, [msgState]);

  const stageIndex = Math.max(0, view.stages.findIndex((s) => s.id === view.matter.stageId));
  const done = view.matter.closed ? view.stages.length : stageIndex;
  const progress = view.stages.length ? Math.min(1, (done + (view.matter.closed ? 0 : 1)) / view.stages.length) : 0;
  const [arc, setArc] = useState(402);
  useEffect(() => {
    const t = requestAnimationFrame(() => setArc(402 - 402 * progress));
    return () => cancelAnimationFrame(t);
  }, [progress]);

  const needed = view.checklist.filter((i) => i.status === "needed");
  const received = view.checklist.filter((i) => i.status !== "needed");
  const pct = view.checklist.length ? Math.round((received.length / view.checklist.length) * 100) : 0;
  const lastStaff = [...view.messages].reverse().find((m) => m.from === "staff");
  const lastClient = [...view.messages].reverse().find((m) => m.from === "client");
  const unread = lastStaff && (!lastClient || lastStaff.at > lastClient.at) ? 1 : 0;
  const fullName = `${view.client.firstName}${view.client.lastName ? ` ${view.client.lastName}` : ""}`;
  const initials = `${view.client.firstName[0] ?? ""}${view.client.lastName?.[0] ?? ""}`.toUpperCase();

  const shown = useMemo(() => {
    const list = filter === "needed" ? needed : filter === "received" ? received : view.checklist;
    const groups = new Map<string, typeof list>();
    for (const i of list) groups.set(i.group ?? "", [...(groups.get(i.group ?? "") ?? []), i]);
    return [...groups.entries()];
  }, [filter, needed, received, view.checklist]);

  function go(t: Tab) {
    setTab(t);
    tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function upload(file: File, itemId: string | null) {
    setUploading(itemId ?? "any");
    setUploadNote(null);
    const fd = new FormData();
    fd.set("file", file);
    if (itemId) fd.set("itemId", itemId);
    try {
      const res = await fetch(`/portal/${token}/upload`, { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { result?: string };
      const r = body.result ?? (res.status === 413 ? "too_large" : "invalid");
      setUploadNote({ ok: r === "ok", message: UPLOAD_MESSAGES[r] ?? UPLOAD_MESSAGES.invalid });
      if (r === "ok") router.refresh();
    } catch {
      setUploadNote({ ok: false, message: "The upload didn't finish. Check your connection and try again." });
    } finally {
      setUploading(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  }

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "journey", label: "Journey" },
    { id: "documents", label: "Documents", badge: needed.length },
    { id: "messages", label: "Messages", badge: tab === "messages" ? 0 : unread },
    { id: "team", label: "Your team" },
  ];

  return (
    <div className="gp">
      <header className="gp-hero">
        <div className="wrap">
          <div className="gp-topline">
            <img src="/brand/gih-logo-horizontal-white.svg" alt="Global Immigration Hub" />
            <form action={signOutAction.bind(null, token)}><button>Sign out</button></form>
          </div>
          <div>
            <div className="gp-kicker">Your application portal</div>
            <h1 className="disp">Welcome back, <em>{view.client.firstName}</em>. {view.matter.closed ? "Your matter is complete." : "Here's where things stand."}</h1>
            <div className="sub">{view.matter.title}, handled by {view.firm.name}, a Global Immigration Hub partner firm.</div>
            <div className="gp-ticket">
              <div><small>Reference</small><span>{view.matter.ref}</span></div>
              {view.matter.service ? <div><small>Service</small><span>{view.matter.service}</span></div> : null}
              <div><small>Opened</small><span>{fmtDate(view.matter.openedAt)}</span></div>
              <div><small>Updated</small><span>{fmtDate(view.updatedAt)}</span></div>
            </div>
          </div>
          <div className="gp-ring" role="img" aria-label={`Stage ${Math.min(stageIndex + 1, view.stages.length)} of ${view.stages.length}`}>
            <svg viewBox="0 0 150 150" aria-hidden="true">
              <circle cx="75" cy="75" r="64" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="10" />
              <circle className="arc" cx="75" cy="75" r="64" fill="none" stroke="#DD1929" strokeWidth="10" strokeLinecap="round" strokeDasharray="402" strokeDashoffset={arc} />
            </svg>
            <div className="num"><div><b>{Math.min(stageIndex + 1, view.stages.length)}/{view.stages.length}</b><small>Stages</small></div></div>
          </div>
        </div>
      </header>

      <nav className="gp-tabs" ref={tabsRef} aria-label="Portal sections">
        <div className="wrap" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} aria-controls={`gp-${t.id}`} onClick={() => setTab(t.id)}>
              {t.label}{t.badge ? <span className="gp-badge">{t.badge}</span> : null}
            </button>
          ))}
        </div>
      </nav>

      <main>
        <div className="wrap">
          <div className="gp-grid">
            <div className="gp-stack">
              {tab === "overview" ? (
                <section id="gp-overview" role="tabpanel" className="gp-stack">
                  <div className={`gp-panel gp-next ${needed.length ? "" : "done"}`}>
                    <div className="ph" role="img" aria-label="Passport on a world map" />
                    <div className="bd">
                      <div className="gp-eyebrow">Your next step</div>
                      {needed.length ? (
                        <>
                          <h2>Upload {needed.length === 1 ? "one document" : `${needed.length} documents`} for your application</h2>
                          <p className="gp-lede" style={{ margin: 0 }}>Still needed: {needed.slice(0, 3).map((i) => i.label).join(", ")}{needed.length > 3 ? ` and ${needed.length - 3} more` : ""}.</p>
                        </>
                      ) : (
                        <>
                          <h2>Nothing needed from you right now</h2>
                          <p className="gp-lede" style={{ margin: 0 }}>Your team is working on your application. We&apos;ll message you here when we need anything.</p>
                        </>
                      )}
                      <div className="gp-btns">
                        {needed.length ? <button className="gp-btn red" onClick={() => go("documents")}>Upload documents</button> : null}
                        <button className="gp-btn ghost" onClick={() => go("messages")}>Message your team</button>
                      </div>
                    </div>
                  </div>
                  <div className="gp-panel">
                    <div className="gp-eyebrow">At a glance</div>
                    <h2 style={{ marginBottom: 14 }}>Where things stand</h2>
                    <div className="gp-stats">
                      <div className="gp-stat"><b>{view.stages[stageIndex]?.name ?? "In progress"}</b><small>Current stage</small></div>
                      <div className="gp-stat"><b>{received.length}/{view.checklist.length}</b><small>Documents in</small></div>
                      <div className="gp-stat"><b>{view.messages.length}</b><small>Messages</small></div>
                    </div>
                  </div>
                  {lastStaff ? (
                    <div className="gp-panel">
                      <div className="gp-eyebrow">Latest from your team · {fmtTime(lastStaff.at)}</div>
                      <p style={{ margin: "8px 0 12px", whiteSpace: "pre-wrap" }}>{lastStaff.body.length > 320 ? `${lastStaff.body.slice(0, 320)}…` : lastStaff.body}</p>
                      <button className="gp-btn ghost" onClick={() => go("messages")}>Open messages</button>
                    </div>
                  ) : null}
                  <div className="gp-dest"><div><b>Every step brings you closer</b><small>Your team handles the detail. This page always shows the latest.</small></div></div>
                </section>
              ) : null}

              {tab === "journey" ? (
                <section id="gp-journey" role="tabpanel" className="gp-panel">
                  <div className="gp-eyebrow">{view.stages.length} stages</div>
                  <h2>Your application journey</h2>
                  <p className="gp-lede">Tap a stage to see what happens and what you need to do.</p>
                  <ol className="gp-journey">
                    {view.stages.map((s, i) => {
                      const state = view.matter.closed || i < stageIndex ? "done" : i === stageIndex ? "now" : "";
                      const open = openStage === s.id;
                      const text = STAGE_TEXT[s.key];
                      return (
                        <li key={s.id} className={`${state} ${open ? "open" : ""}`}>
                          <span className="gp-jdot" aria-hidden="true">{state === "done" ? "✓" : i + 1}</span>
                          <div>
                            <button className="gp-jhead" aria-expanded={open} onClick={() => setOpenStage(open ? null : s.id)}>
                              <span><b>{s.name}</b><small>{state === "done" ? "Done" : state === "now" ? "Happening now" : "Coming up"}</small></span>
                              <svg className="gp-chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
                            </button>
                            {open ? (
                              <div className="gp-jbody">
                                <p>{text?.what ?? "Your team will explain this stage when you reach it."}</p>
                                {text ? <p className="gp-hint"><b>What you do:</b> {text.you}</p> : null}
                                {s.key === "submission" && view.matter.submittedOn ? <p className="gp-hint">Submitted on {fmtDate(view.matter.submittedOn)}{view.matter.submissionChannel ? ` via ${view.matter.submissionChannel}` : ""}.</p> : null}
                              </div>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ) : null}

              {tab === "documents" ? (
                <section id="gp-documents" role="tabpanel" className="gp-panel">
                  <div className="gp-eyebrow">Checklist</div>
                  <h2>Your documents</h2>
                  <p className="gp-lede">Upload here or email them to {view.firm.email ?? "your team"}. We don&apos;t accept documents on WhatsApp.</p>
                  {view.checklist.length ? (
                    <>
                      <div className="gp-docbar"><div className="gp-track"><i style={{ width: `${pct}%` }} /></div><b style={{ fontVariantNumeric: "tabular-nums" }}>{pct}%</b></div>
                      <div className="gp-filters" role="group" aria-label="Filter documents">
                        {(["all", "needed", "received"] as const).map((f) => (
                          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "needed" ? `Still needed (${needed.length})` : `Received (${received.length})`}</button>
                        ))}
                      </div>
                      {shown.map(([group, items]) => (
                        <div key={group || "_"}>
                          {group ? <div className="gp-group">{group}</div> : null}
                          <div className="gp-doclist">
                            {items.map((d) => (
                              <div className="gp-doc" key={d.id}>
                                <span className="ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg></span>
                                <div style={{ minWidth: 0 }}>
                                  <b>{d.label}</b>
                                  <small>{d.status === "accepted" ? "Checked and accepted" : d.status === "uploaded" ? "Received, being checked" : "Still needed"}</small>
                                </div>
                                {d.status === "accepted" ? <span className="gp-chip ok">Accepted</span> : d.status === "uploaded" ? <span className="gp-chip rev">Checking</span> : (
                                  <label className="gp-up">
                                    {uploading === d.id ? "Uploading…" : "Upload"}
                                    <input type="file" aria-label={`Upload ${d.label}`} accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.doc,.docx" disabled={!!uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, d.id); e.target.value = ""; }} />
                                  </label>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  ) : <p className="gp-empty">Your team will add your document checklist here.</p>}
                  <div
                    className={`gp-drop ${dragOver ? "over" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f, null); }}
                  >
                    {uploading === "any" ? "Uploading…" : <>Something else to send? <b>Drop a file here</b> or tap to choose one. PDF, photo or Word, up to 15 MB.</>}
                    <input type="file" aria-label="Upload another document" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.doc,.docx" disabled={!!uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, null); e.target.value = ""; }} />
                  </div>
                  {uploadNote ? <p className={`gp-note ${uploadNote.ok ? "ok" : "err"}`} role="status">{uploadNote.message}</p> : null}
                  {view.uploads.length ? (
                    <>
                      <div className="gp-group">Your uploads</div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                        {view.uploads.slice(0, 12).map((u) => <li key={u.id}>{u.filename} <span className="gp-hint">· {fmtTime(u.at)}</span></li>)}
                      </ul>
                    </>
                  ) : null}
                </section>
              ) : null}

              {tab === "messages" ? (
                <section id="gp-messages" role="tabpanel" className="gp-panel">
                  <div className="gp-eyebrow">Conversation</div>
                  <h2>Messages with your team</h2>
                  <p className="gp-lede">Ask anything about your application. Your team replies here, usually within one working day, and we&apos;ll email you when they do.</p>
                  <div className="gp-thread">
                    {view.messages.length ? view.messages.map((m) => (
                      <div key={m.id} className={`gp-msg ${m.from}`}>
                        <span className="av" aria-hidden="true">{m.from === "client" ? initials : view.firm.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
                        <div className="gp-bubble">
                          <div className="gp-who"><b>{m.from === "client" ? "You" : m.name}</b><time dateTime={m.at}>{fmtTime(m.at)}</time></div>
                          <p>{m.body}</p>
                        </div>
                      </div>
                    )) : <p className="gp-empty">No messages yet. Say hello, or ask your first question.</p>}
                  </div>
                  <form ref={formRef} action={sendMsg} className="gp-composer">
                    <label htmlFor="gp-msg" className="gp-hint" style={{ display: "block", padding: "10px 14px 0" }}>Write a message</label>
                    <textarea id="gp-msg" name="body" maxLength={4000} placeholder="Type your question or update…" required />
                    <div className="bar">
                      <span className="gp-hint">Sent to {view.firm.name}</span>
                      <button className="gp-btn" disabled={sendingMsg}>{sendingMsg ? "Sending…" : "Send message"}</button>
                    </div>
                  </form>
                  {msgState?.message ? <p className={`gp-note ${msgState.ok ? "ok" : "err"}`} role="status">{msgState.message}</p> : null}
                </section>
              ) : null}

              {tab === "team" ? (
                <section id="gp-team" role="tabpanel" className="gp-panel">
                  <div className="gp-teamph" role="img" aria-label="Consultant welcoming a client" />
                  <div className="gp-eyebrow">Who is looking after you</div>
                  <h2>{view.firm.name}, Client Services</h2>
                  <p className="gp-lede">Your file is run by the {view.firm.name} team through Global Immigration Hub, the shared front door for Veritas Emigrate, Mimshac Group and Nextmove.</p>
                  <div className="gp-stack" style={{ gap: 14 }}>
                    <div className="gp-office"><b>Pretoria centre</b><span>115 Paul Kruger Street, New Court Chambers, 2nd Floor, Pretoria Central</span><small>Monday to Friday · please book before visiting</small></div>
                    <div className="gp-office"><b>Harare centre</b><span>Office 2, 12th Floor, Joina City, Harare</span></div>
                  </div>
                </section>
              ) : null}
            </div>

            <aside className="gp-stack">
              <div className="gp-panel gp-card">
                <div className="top"><div className="gp-avatar" aria-hidden="true">{initials}</div><div><b>{fullName}</b><small>Client since {fmtDate(view.client.since)}</small></div></div>
                <dl>
                  <div><dt>Email</dt><dd><span>{view.client.email}</span><button className="gp-copy" onClick={() => copy(view.client.email)}>{copied === view.client.email ? "Copied" : "Copy"}</button></dd></div>
                  {view.client.phone ? <div><dt>Phone</dt><dd><span>{view.client.phone}</span><button className="gp-copy" onClick={() => copy(view.client.phone!)}>{copied === view.client.phone ? "Copied" : "Copy"}</button></dd></div> : null}
                  {view.client.nationality ? <div><dt>Nationality</dt><dd>{view.client.nationality}</dd></div> : null}
                  <div><dt>Matter</dt><dd>{view.matter.title}</dd></div>
                  <div><dt>Reference</dt><dd><span>{view.matter.ref}</span><button className="gp-copy" onClick={() => copy(view.matter.ref)}>{copied === view.matter.ref ? "Copied" : "Copy"}</button></dd></div>
                  <div><dt>Firm</dt><dd>{view.firm.name}</dd></div>
                </dl>
              </div>
              <div className="gp-panel">
                <div className="gp-eyebrow">Need help?</div>
                <div className="gp-help">
                  {view.firm.email ? <span>Email <b>{view.firm.email}</b></span> : null}
                  {view.firm.phone ? <span>Phone <b>{view.firm.phone}</b></span> : null}
                  <span>WhatsApp <b>+61 490 836 628</b></span>
                  <small>Always quote {view.matter.ref}</small>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
      <footer className="gp-foot"><div className="wrap"><span>Global Immigration Hub · Partner firms: Veritas Emigrate · Mimshac Group · Nextmove</span><span>This portal is private to you. Please don&apos;t forward the link.</span></div></footer>
    </div>
  );
}
