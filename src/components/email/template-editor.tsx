"use client";

import { ArrowDown, ArrowUp, Code2, Eye, FileText, LayoutList, Monitor, Plus, Smartphone, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { previewTemplateAction, saveTemplateAction } from "@/app/(staff)/email-actions";
import { Button, Checkbox, Field, Input, Notice, Select, Textarea, cn } from "@/components/ui/primitives";
import { TEMPLATE_CATEGORIES } from "@/lib/email-categories";
import type { EmailBlock, TemplateSlot } from "@/server/db/schema";
import { MERGE_FIELDS, unknownFields } from "@/server/modules/email/render";
import { EmailFrame } from "./frame";

type Draft = { name: string; category: string; subject: string; preheader: string; blocks: EmailBlock[]; isActive: boolean; format?: "blocks" | "html"; html?: string | null; slots?: TemplateSlot[]; textOverride?: string | null };

/** Editable sections declared in the HTML as {{edit:key}}, keeping labels already written. */
function syncSlots(html: string, existing: TemplateSlot[]): TemplateSlot[] {
  const keys = [...new Set([...html.matchAll(/\{\{\s*edit:([a-z_]+)\s*\}\}/g)].map((m) => m[1]))];
  return keys.map((k) => existing.find((s) => s.key === k) ?? { key: k, label: k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), default: "", multiline: true });
}

const NEW_BLOCK: Record<EmailBlock["type"], EmailBlock> = {
  heading: { type: "heading", text: "" },
  paragraph: { type: "paragraph", text: "" },
  button: { type: "button", label: "", url: "https://" },
  details: { type: "details", rows: [{ label: "", value: "" }] },
  notice: { type: "notice", text: "" },
  divider: { type: "divider" },
};
const BLOCK_LABEL: Record<EmailBlock["type"], string> = { heading: "Heading", paragraph: "Paragraph", button: "Button", details: "Details table", notice: "Highlighted note", divider: "Divider" };
const CATEGORIES: string[] = [...TEMPLATE_CATEGORIES];

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
  const [d, setD] = useState<Draft>({ format: "blocks", html: null, slots: [], textOverride: null, ...initial });
  const [preview, setPreview] = useState<{ html: string; subject: string; text: string } | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile" | "text">("desktop");
  const isHtml = d.format === "html";
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
  const allText = [d.subject, d.preheader, ...(isHtml ? [d.html ?? "", d.textOverride ?? ""] : d.blocks.map((b) => JSON.stringify(b)))].join(" ").replace(/\{\{\s*(edit:[a-z_]+|signature)\s*\}\}/g, "");
  const unknown = unknownFields(allText);
  const setHtml = (html: string) => set({ html, slots: syncSlots(html, d.slots ?? []) });

  const runPreview = () =>
    startPreview(async () => {
      const r = await previewTemplateAction(scopeKey, { subject: d.subject, preheader: d.preheader, blocks: d.blocks, format: d.format, html: d.html, slots: d.slots, textOverride: d.textOverride });
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

          <div className="inline-flex self-start rounded-md border border-hairline-strong p-0.5 text-xs" role="radiogroup" aria-label="How the template is built">
            <button type="button" role="radio" aria-checked={!isHtml} onClick={() => set({ format: "blocks" })} className={cn("inline-flex items-center gap-1.5 rounded px-2.5 py-1", !isHtml ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink")}><LayoutList className="size-3.5" /> Built from blocks</button>
            <button type="button" role="radio" aria-checked={isHtml} onClick={() => set({ format: "html" })} className={cn("inline-flex items-center gap-1.5 rounded px-2.5 py-1", isHtml ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink")}><Code2 className="size-3.5" /> HTML design</button>
          </div>
          {isHtml ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-ink">HTML</p>
                <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-hairline-strong px-2.5 text-xs text-ink-2 hover:bg-sunken">
                  <Upload className="size-3.5" /> Import an .html file
                  <input type="file" accept=".html,.htm,text/html" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setHtml(await f.text()); e.target.value = ""; }} />
                </label>
              </div>
              <Textarea aria-label="Template HTML" rows={16} value={d.html ?? ""} onChange={(e) => setHtml(e.target.value)} className="font-mono text-xs leading-relaxed" spellCheck={false} placeholder="Paste the email's HTML. Mark editable sections with {{edit:intro}}, merge fields like {{first_name}}, and the signature spot with {{signature}}." />
              <p className="text-xs text-muted">Scripts, forms, event handlers and remote stylesheets are removed when you save. The design and inline styles are kept.</p>
              <div className="flex flex-col gap-2">
                <p className="text-[13px] font-medium text-ink">Editable sections</p>
                {(d.slots ?? []).length ? (d.slots ?? []).map((sl, i) => (
                  <div key={sl.key} className="grid gap-2 rounded-md border border-hairline bg-surface p-2.5 sm:grid-cols-[140px_1fr_1.4fr_auto] sm:items-center">
                    <code className="text-xs text-ink-2">{`{{edit:${sl.key}}}`}</code>
                    <Input aria-label="Label" value={sl.label} onChange={(e) => set({ slots: (d.slots ?? []).map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <Input aria-label="Guidance" placeholder="Guidance shown to staff" value={sl.default} onChange={(e) => set({ slots: (d.slots ?? []).map((x, j) => (j === i ? { ...x, default: e.target.value } : x)) })} />
                    <Checkbox checked={sl.multiline} onChange={(e) => set({ slots: (d.slots ?? []).map((x, j) => (j === i ? { ...x, multiline: e.currentTarget.checked } : x)) })} label="Long text" />
                  </div>
                )) : <p className="text-xs text-muted">None yet. Add {"{{edit:name}}"} in the HTML where staff should write.</p>}
              </div>
              <Field label="Plain-text version (optional)" name="textOverride" hint="Sent alongside the HTML for clients whose email shows text only. Leave empty to generate it from the HTML.">
                <Textarea rows={5} value={d.textOverride ?? ""} onChange={(e) => set({ textOverride: e.target.value })} />
              </Field>
            </div>
          ) : (
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
            )}
          <Checkbox checked={d.isActive} onChange={(e) => set({ isActive: e.target.checked })} label="Available when sending" />
        </fieldset>

        {unknown.length ? <Notice tone="warn">Unknown field{unknown.length > 1 ? "s" : ""}: {unknown.map((u) => `{{${u}}}`).join(", ")}. Saving is blocked until it&apos;s fixed.</Notice> : null}
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
                  const r = await saveTemplateAction(scopeKey, id, isHtml ? { ...d, blocks: [] } : d);
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
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-xs text-muted">Subject: <span className="text-ink">{preview.subject}</span> · sample client “Thandi”</p>
              <div className="inline-flex rounded-md border border-hairline-strong p-0.5" role="radiogroup" aria-label="Preview size">
                {([["desktop", Monitor, "Desktop"], ["mobile", Smartphone, "Mobile"], ["text", FileText, "Plain text"]] as const).map(([k, Icon, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={device === k} aria-label={label} title={label} onClick={() => setDevice(k)} className={cn("rounded px-2 py-1", device === k ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink")}><Icon className="size-3.5" /></button>
                ))}
              </div>
            </div>
            {device === "text" ? (
              <pre className="max-h-[680px] overflow-auto rounded-md border border-hairline bg-white p-3 text-xs leading-relaxed whitespace-pre-wrap text-ink">{preview.text}</pre>
            ) : (
              <div className={cn("mx-auto w-full", device === "mobile" && "max-w-[390px]")}><EmailFrame html={preview.html} title="Template preview" height={680} allowSameSiteImages /></div>
            )}
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
