"use server";

import { revalidatePath } from "next/cache";
import { toActionError, type ActionResult } from "@/server/errors";
import { cancelEvent, createEvent, updateEvent } from "@/server/modules/calendar/calendar";
import { addNote, deleteNote, editNote, noteHistory, type NoteSubject } from "@/server/modules/notes/notes";
import { cancelTask, claimTask, completeTask, createTask, reopenTask, updateTask } from "@/server/modules/tasks/tasks";
import { requireFirm, requireStaff } from "@/server/next/session";

const data = (f: FormData) => Object.fromEntries([...f.keys()].map((k) => [k, String(f.get(k))]));

function refresh() {
  revalidatePath("/", "layout");
}

/* Tasks */
export async function createTaskAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await createTask(ctx, data(form));
  } catch (err) {
    return toActionError(err);
  }
  refresh();
  return { ok: true, message: "Task added." };
}

export async function updateTaskAction(id: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await updateTask(ctx, id, data(form));
  } catch (err) {
    return toActionError(err);
  }
  refresh();
  return { ok: true, message: "Task saved." };
}

export async function taskStatusAction(id: string, action: "complete" | "reopen" | "cancel" | "claim"): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    if (action === "complete") {
      const { next } = await completeTask(ctx, id);
      refresh();
      return { ok: true, message: next ? "Done. The next one is scheduled." : "Done." };
    }
    if (action === "reopen") await reopenTask(ctx, id);
    if (action === "cancel") await cancelTask(ctx, id);
    if (action === "claim") await claimTask(ctx, id);
  } catch (err) {
    return toActionError(err);
  }
  refresh();
  return { ok: true, message: action === "reopen" ? "Reopened." : action === "cancel" ? "Task cancelled." : "It's yours." };
}

/* Calendar */
export async function createEventAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await createEvent(ctx, data(form));
  } catch (err) {
    return toActionError(err);
  }
  refresh();
  return { ok: true, message: "Added to the calendar." };
}

export async function updateEventAction(id: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await updateEvent(ctx, id, data(form));
  } catch (err) {
    return toActionError(err);
  }
  refresh();
  return { ok: true, message: "Event saved." };
}

export async function cancelEventAction(id: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await cancelEvent(ctx, id);
  } catch (err) {
    return toActionError(err);
  }
  refresh();
  return { ok: true, message: "Event cancelled." };
}

/* Notes */
export async function addNoteAction(slug: string, subject: NoteSubject, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await addNote(ctx, firm.firmId, subject, data(form));
  } catch (err) {
    return toActionError(err);
  }
  refresh();
  return { ok: true, message: "Note added." };
}

export async function editNoteAction(slug: string, noteId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await editNote(ctx, firm.firmId, noteId, data(form));
  } catch (err) {
    return toActionError(err);
  }
  refresh();
  return { ok: true, message: "Note saved. The earlier version is kept in its history." };
}

export async function deleteNoteAction(slug: string, noteId: string): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await deleteNote(ctx, firm.firmId, noteId);
  } catch (err) {
    return toActionError(err);
  }
  refresh();
  return { ok: true, message: "Note deleted. Its history is kept." };
}

export async function noteHistoryAction(slug: string, noteId: string) {
  const { ctx, firm } = await requireFirm(slug);
  const rows = await noteHistory(ctx, firm.firmId, noteId);
  return rows.map((r) => ({ ...r, editedAt: r.editedAt.toISOString() }));
}
