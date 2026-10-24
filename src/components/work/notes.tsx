"use client";

import { History, Lock, Pencil, Trash2, Users } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { addNoteAction, deleteNoteAction, editNoteAction, noteHistoryAction } from "@/app/(staff)/work-actions";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ActionFeedback, LocalTime, SubmitButton } from "@/components/ui/forms";
import { Button, cn, EmptyState, Select, Textarea } from "@/components/ui/primitives";
import type { NoteSubject } from "@/server/modules/notes/notes";

export type NoteRow = { id: string; body: string; visibility: "internal" | "client_visible"; version: number; author: string | null; editor: string | null; authorId: string | null; createdAt: string; updatedAt: string };

function VisibilityTag({ v }: { v: NoteRow["visibility"] }) {
  return v === "internal" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn"><Lock className="size-3" /> Internal</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok"><Users className="size-3" /> Client-visible</span>
  );
}

function VisibilitySelect({ id, defaultValue }: { id: string; defaultValue?: string }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-2" htmlFor={id}>
      Who can see it
      <Select id={id} name="visibility" defaultValue={defaultValue ?? "internal"} className="h-8 w-auto text-[13px]">
        <option value="internal">Internal: staff only</option>
        <option value="client_visible">Client-visible (for the client portal)</option>
      </Select>
    </label>
  );
}

function NoteForm({ slug, subject }: { slug: string; subject: NoteSubject }) {
  const [state, action] = useActionState(addNoteAction.bind(null, slug, subject), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <ActionFeedback state={state} />
      <label htmlFor="new-note" className="sr-only">Add a note</label>
      <Textarea id="new-note" name="body" rows={3} placeholder="Add a note" required maxLength={10000} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <VisibilitySelect id="new-note-vis" />
        <SubmitButton size="sm" pendingText="Adding…">Add note</SubmitButton>
      </div>
    </form>
  );
}

function EditNote({ slug, note, onDone }: { slug: string; note: NoteRow; onDone: () => void }) {
  const [state, action] = useActionState(editNoteAction.bind(null, slug, note.id), null);
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-2">
      <ActionFeedback state={state} />
      <label htmlFor={`edit-${note.id}`} className="sr-only">Edit note</label>
      <Textarea id={`edit-${note.id}`} name="body" rows={4} defaultValue={note.body} required maxLength={10000} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <VisibilitySelect id={`edit-vis-${note.id}`} defaultValue={note.visibility} />
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
          <SubmitButton size="sm">Save note</SubmitButton>
        </div>
      </div>
    </form>
  );
}

function HistoryDialog({ slug, note, open, onOpenChange }: { slug: string; note: NoteRow; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof noteHistoryAction>> | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    noteHistoryAction(slug, note.id).then((r) => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [open, slug, note.id]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Note history" description="Every version of this note, newest first." wide>
        {rows === null ? <p className="text-[13px] text-muted">Loading…</p> : (
          <ol className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.version} className="rounded-xl border border-hairline p-3">
                <p className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-medium text-ink-2">Version {r.version}</span> · {r.editor ?? "Unknown"} · <LocalTime value={r.editedAt} /> <VisibilityTag v={r.visibility} />
                </p>
                <p className="text-[13px] whitespace-pre-wrap text-ink">{r.body}</p>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoteItem({ slug, note, canEdit }: { slug: string; note: NoteRow; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [pending, start] = useTransition();
  return (
    <li className={cn("rounded-xl border px-4 py-3", note.visibility === "internal" ? "border-warn/25 bg-warn-soft/40" : "border-ok/25 bg-ok-soft/40")}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
        <VisibilityTag v={note.visibility} />
        <span className="font-medium text-ink-2">{note.author ?? "Unknown"}</span>
        <LocalTime value={note.createdAt} mode="relative" />
        {note.version > 1 ? <span>· edited{note.editor ? ` by ${note.editor}` : ""}</span> : null}
        <span className="ml-auto flex gap-1">
          {note.version > 1 ? <Button size="icon" variant="ghost" aria-label="Show history" onClick={() => setHistory(true)}><History /></Button> : null}
          {canEdit && !editing ? <Button size="icon" variant="ghost" aria-label="Edit note" onClick={() => setEditing(true)}><Pencil /></Button> : null}
          {canEdit ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label="Delete note"
              disabled={pending}
              onClick={() => start(async () => {
                if (!window.confirm("Delete this note? Its history is kept for the audit trail.")) return;
                const r = await deleteNoteAction(slug, note.id);
                if (r.ok) toast.success(r.message); else toast.error(r.error);
              })}
            ><Trash2 /></Button>
          ) : null}
        </span>
      </div>
      {editing ? <EditNote slug={slug} note={note} onDone={() => setEditing(false)} /> : <p className="max-w-[80ch] text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{note.body}</p>}
      {history ? <HistoryDialog slug={slug} note={note} open={history} onOpenChange={setHistory} /> : null}
    </li>
  );
}

/** Notes on a record: add, edit with history, delete; internal and client-visible notes look different. */
export function NotesPanel({ slug, subject, notes, canWrite, canModerate, meId }: { slug: string; subject: NoteSubject; notes: NoteRow[]; canWrite: boolean; canModerate: boolean; meId: string }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {canWrite ? <NoteForm slug={slug} subject={subject} /> : null}
      {notes.length ? (
        <ul className="flex flex-col gap-2.5">
          {notes.map((n) => <NoteItem key={n.id} slug={slug} note={n} canEdit={canWrite && (n.authorId === meId || canModerate)} />)}
        </ul>
      ) : (
        <EmptyState title="No notes yet">Internal notes stay with staff. Client-visible notes are marked for the client portal when it arrives.</EmptyState>
      )}
    </div>
  );
}
