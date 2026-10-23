"use client";

import { ArrowDown, ArrowUp, Eye, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { previewTemplateAction, saveTemplateAction } from "@/app/(staff)/email-actions";
import { Button, Checkbox, Field, Input, Notice, Select, Textarea } from "@/components/ui/primitives";
import type { EmailBlock } from "@/server/db/schema";
import { MERGE_FIELDS, unknownFields } from "@/server/modules/email/render";
import { EmailFrame } from "./client";

type Draft = { name: string; category: string; subject: string; preheader: string; blocks: EmailBlock[]; isActive: boolean };

const NEW_BLOCK: Record<EmailBlock["type"], EmailBlock> = {
  heading: { type: "heading", text: "" },
  paragraph: { type: "paragraph", text: "" },
  button: { type: "button", label: "", url: "https://" },
  details: { type: "details", rows: [{ label: "", value: "" }] },
  notice: { type: "notice", text: "" },
  divider: { type: "divider" },
};
const BLOCK_LABEL: Record<EmailBlock["type"], string> = { heading: "Heading", paragraph: "Paragraph", button: "Button", details: "Details table", notice: "Highlighted note", divider: "Divider" };
const CATEGORIES = ["General", "Enquiries", "Consultations", "Proposals", "Matters", "Finance", "Updates"];

function BlockFields({ block, onChange, index }: { block: EmailBlock; onChange: (b: EmailBlock) => void; index: number }) {
  const id = `b${index}`;
  switch (block.type) {
    case "heading":
      return <Input aria-label={`Block ${index + 1} heading`} id={id} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} maxLength={200} />;
    case "paragraph":
    case "notice":
      return <Textarea aria-label={`Block ${index + 1} text`} id={id} rows={block.type === "paragraph" ? 4 : 2} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} maxLength={5000} />;
    case "button":
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
          <Input aria-label={`Block ${index + 1} button text`} value={block.label} placeholder="Button text" onChange={(e) => onChange({ ...block, label: e.target.value })} maxLength={60} />
          <Input aria-label={`Block ${index + 1} link`} value={block.url} placeholder="https://" onChange={(e) => onChange({ ...block, url: e.target.value })} maxLength={500} />
        </div>
      );
    case "details":
      return (
        <div className="flex flex-col gap-1.5">
          {block.rows.map((r, j) => (
            <div key={j} className="grid grid-cols-[1fr_1.4fr_2rem] gap-2">
              <Input aria-label={`Row ${j + 1} label`} value={r.label} placeholder="Label" onChange={(e) => onChange({ ...block, rows: block.rows.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) })} />
              <Input aria-label={`Row ${j + 1} value`} value={r.value} placeholder="Value" onChange={(e) => onChange({ ...block, rows: block.rows.map((x, k) => (k === j ? { ...x, value: e.target.value } : x)) })} />
              <Button type="button" size="icon" variant="ghost" aria-label={`Remove row ${j + 1}`} disabled={block.rows.length === 1} onClick={() => onChange({ ...block, rows: block.rows.filter((_, k) => k !== j) })}><Trash2 /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" className="self-start" disabled={block.rows.length >= 15} onClick={() => onChange({ ...block, rows: [...block.rows, { label: "", value: "" }] })}><Plus /> Add row</Button>
        </div>
      );
    case "divider":
      return <p className="text-xs text-muted">A thin line between sections.</p>;
  }
}

export function TemplateEditor({ scopeKey, base, id, initial, readOnly }: { scopeKey: string; base: string; id: string | null; initial: Draft; readOnly?: boolean }) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(initial);
  const [preview, setPreview] = useState<{ html: string; subject: string } | null>(null);
  const [saving, startSave] = useTransition();
  const [previewing, startPreview] = useTransition();
  const [addType, setAddType] = useState<EmailBlock["type"]>("paragraph");
  const set = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    setPreview(null);
  };
  const setBlock = (i: number, b: EmailBlock) => set({ blocks: d.blocks.map((x, j) => (j === i ? b : x)) });
  const move = (i: number, dir: -1 | 1) => {
    const next = [...d.blocks];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    set({ blocks: next });
  };
  const allText = [d.subject, d.preheader, ...d.blocks.map((b) => JSON.stringify(b))].join(" ");
  const unknown = unknownFields(allText);

  const runPreview = () =>
    startPreview(async () => {
      const r = await previewTemplateAction(scopeKey, { subject: d.subject, preheader: d.preheader, blocks: d.blocks });
      if (r.ok && r.data) setPreview(r.data);
      else if (!r.ok) toast.error(r.error);
    });

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,640px)]">
      <div className="flex flex-col gap-4">
        <fieldset disabled={readOnly} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Field label="Template name" name="name"><Input value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required /></Field>
            <Field label="Group" name="category"><Select value={d.category} onChange={(e) => set({ category: e.target.value })}>{[...new Set([...CATEGORIES, d.category])].map((c) => <option key={c}>{c}</option>)}</Select></Field>
          </div>
          <Field label="Subject line" name="subject"><Input value={d.subject} onChange={(e) => set({ subject: e.target.value })} maxLength={200} required /></Field>
          <Field label="Preview text" name="preheader" hint="The grey line many inboxes show after the subject."><Input value={d.preheader} onChange={(e) => set({ preheader: e.target.value })} maxLength={200} /></Field>

          <div className="flex flex-col gap-3">
            <p className="text-[13px] font-medium text-ink">Content</p>
            {d.blocks.map((b, i) => (
              <div key={i} className="rounded-md border border-hairline bg-surface p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-2">{BLOCK_LABEL[b.type]}</span>
                  <span className="flex">
                    <Button type="button" size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                    <Button type="button" size="icon" variant="ghost" aria-label="Move down" disabled={i === d.blocks.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                    <Button type="button" size="icon" variant="ghost" aria-label="Remove block" disabled={d.blocks.length === 1} onClick={() => set({ blocks: d.blocks.filter((_, j) => j !== i) })}><Trash2 /></Button>
                  </span>
                </div>
                <BlockFields block={b} index={i} onChange={(nb) => setBlock(i, nb)} />
              </div>
            ))}
            <div className="flex items-end gap-2">
              <Field label="Add a block" name="addType"><Select value={addType} onChange={(e) => setAddType(e.target.value as EmailBlock["type"])}>{Object.entries(BLOCK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Button type="button" disabled={d.blocks.length >= 40} onClick={() => set({ blocks: [...d.blocks, structuredClone(NEW_BLOCK[addType])] })}><Plus /> Add</Button>
            </div>
          </div>
          <Checkbox checked={d.isActive} onChange={(e) => set({ isActive: e.target.checked })} label="Available when sending" />
        </fieldset>

        {unknown.length ? <Notice tone="warn">Unknown field{unknown.length > 1 ? "s" : ""}: {unknown.map((u) => `{{${u}}}`).join(", ")}. They will show as typed.</Notice> : null}
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Fields you can use</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">{Object.entries(MERGE_FIELDS).map(([k, v]) => <li key={k}><code className="text-ink">{`{{${k}}}`}</code> {v}</li>)}</ul>
          <p className="mt-2">Write **two asterisks** around words to make them bold.</p>
        </details>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={runPreview} disabled={previewing}><Eye /> {previewing ? "Preparing…" : "Preview"}</Button>
          {readOnly ? null : (
            <Button
              type="button"
              variant="primary"
              disabled={saving}
              onClick={() =>
                startSave(async () => {
                  const r = await saveTemplateAction(scopeKey, id, d);
                  if (r.ok) {
                    toast.success(r.message ?? "Saved.");
                    if (!id && r.data) router.push(`${base}/templates/${r.data.id}`);
                    else router.refresh();
                  } else {
                    toast.error(r.error + (r.fieldErrors ? ` ${Object.values(r.fieldErrors)[0] ?? ""}` : ""));
                  }
                })
              }
            >
              {saving ? "Saving…" : id ? "Save template" : "Create template"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 xl:sticky xl:top-20 xl:self-start">
        <p className="text-[13px] font-medium text-ink">Preview</p>
        {preview ? (
          <>
            <p className="text-xs text-muted">Subject: <span className="text-ink">{preview.subject}</span> · sample client “Thandi”</p>
            <EmailFrame html={preview.html} title="Template preview" height={680} />
          </>
        ) : (
          <div className="flex h-[300px] items-center justify-center rounded-md border border-dashed border-hairline-strong text-[13px] text-muted">
            <Button type="button" onClick={runPreview} disabled={previewing}><Eye /> Show preview</Button>
          </div>
        )}
      </div>
    </div>
  );
}
