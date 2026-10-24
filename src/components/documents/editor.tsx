"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Braces, Heading1, Heading2, Heading3, Italic, List, ListOrdered, Minus, Quote, Redo2, SquareDashed, Strikethrough, Underline, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/components/ui/primitives";

/** Highlights merge fields ({{…}}) and passages still to write ([[…]]) so gaps are visible while drafting. */
const GapHighlight = Extension.create({
  name: "gapHighlight",
  addProseMirrorPlugins() {
    const find = (doc: PMNode) => {
      const decos: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;
        for (const m of node.text.matchAll(/\{\{[^}]{1,80}\}\}|\[\[[^\]]{1,300}\]\]/g)) {
          const from = pos + (m.index ?? 0);
          decos.push(Decoration.inline(from, from + m[0].length, { class: m[0].startsWith("{{") ? "doc-field" : "doc-gap" }));
        }
      });
      return DecorationSet.create(doc, decos);
    };
    return [
      new Plugin({
        key: new PluginKey("gapHighlight"),
        state: { init: (_, { doc }) => find(doc), apply: (tr, old) => (tr.docChanged ? find(tr.doc) : old) },
        props: { decorations(state) { return this.getState(state); } },
      }),
    ];
  },
});

export type DocJson = { type: "doc"; content?: unknown[] };

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={cn("flex size-8 items-center justify-center rounded text-ink-2 hover:bg-sunken hover:text-ink disabled:opacity-40", active && "bg-accent-soft text-accent")}>
      {children}
    </button>
  );
}

function Toolbar({ editor, fields }: { editor: Editor; fields: [string, string][] }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), quote: e.isActive("blockquote"), undo: e.can().undo(), redo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatting" className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-hairline bg-surface/95 px-2 py-1 backdrop-blur">
      <ToolButton label="Bold" active={s.bold} onClick={() => c().toggleBold().run()}><Bold className="size-4" /></ToolButton>
      <ToolButton label="Italic" active={s.italic} onClick={() => c().toggleItalic().run()}><Italic className="size-4" /></ToolButton>
      <ToolButton label="Underline" active={s.underline} onClick={() => c().toggleUnderline().run()}><Underline className="size-4" /></ToolButton>
      <ToolButton label="Strikethrough" active={s.strike} onClick={() => c().toggleStrike().run()}><Strikethrough className="size-4" /></ToolButton>
      <span className="mx-1 h-5 w-px bg-hairline" aria-hidden />
      <ToolButton label="Title" active={s.h1} onClick={() => c().toggleHeading({ level: 1 }).run()}><Heading1 className="size-4" /></ToolButton>
      <ToolButton label="Section heading" active={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}><Heading2 className="size-4" /></ToolButton>
      <ToolButton label="Sub-heading" active={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}><Heading3 className="size-4" /></ToolButton>
      <ToolButton label="Bulleted list" active={s.bullet} onClick={() => c().toggleBulletList().run()}><List className="size-4" /></ToolButton>
      <ToolButton label="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()}><ListOrdered className="size-4" /></ToolButton>
      <ToolButton label="Quote" active={s.quote} onClick={() => c().toggleBlockquote().run()}><Quote className="size-4" /></ToolButton>
      <ToolButton label="Divider" onClick={() => c().setHorizontalRule().run()}><Minus className="size-4" /></ToolButton>
      <span className="mx-1 h-5 w-px bg-hairline" aria-hidden />
      <label className="flex items-center gap-1 text-[13px] text-ink-2">
        <Braces className="size-4" aria-hidden />
        <span className="sr-only">Insert merge field</span>
        <select
          className="h-8 rounded border border-hairline bg-surface px-1.5 text-[13px]"
          value=""
          onChange={(e) => {
            if (e.target.value) c().insertContent(`{{${e.target.value}}}`).run();
          }}
        >
          <option value="">Merge field…</option>
          {fields.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <ToolButton label="Mark text still to write" onClick={() => {
        const { from, to } = editor.state.selection;
        const sel = editor.state.doc.textBetween(from, to, " ");
        c().insertContent(`[[${sel || "To complete"}]]`).run();
      }}><SquareDashed className="size-4" /></ToolButton>
      <span className="ml-auto flex">
        <ToolButton label="Undo" disabled={!s.undo} onClick={() => c().undo().run()}><Undo2 className="size-4" /></ToolButton>
        <ToolButton label="Redo" disabled={!s.redo} onClick={() => c().redo().run()}><Redo2 className="size-4" /></ToolButton>
      </span>
    </div>
  );
}

/** Rich-text editor for documents and templates. Calls onChange with the ProseMirror JSON. */
export function DocEditor({ initial, editable, onChange, fields, label }: { initial: DocJson; editable: boolean; onChange?: (doc: DocJson) => void; fields: [string, string][]; label: string }) {
  const changeRef = useRef(onChange);
  // The editor can normalise content on load; only real edits count as changes.
  const baseline = useRef<string | null>(null);
  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [StarterKit.configure({ code: false, codeBlock: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, protocols: ["https", "mailto"] } }), GapHighlight],
    content: initial as JSONContent,
    editorProps: { attributes: { class: "doc-prose min-h-[420px] px-8 py-6 focus:outline-none", "aria-label": label, role: "textbox", "aria-multiline": "true" } },
    onCreate: ({ editor: e }) => {
      baseline.current = JSON.stringify(e.getJSON());
    },
    onUpdate: ({ editor: e }) => {
      const json = e.getJSON();
      if (baseline.current !== null && JSON.stringify(json) === baseline.current) return;
      baseline.current = null;
      changeRef.current?.(json as DocJson);
    },
  });
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);
  return (
    <div className="overflow-hidden rounded-md border border-hairline bg-surface">
      {editor && editable ? <Toolbar editor={editor} fields={fields} /> : null}
      <EditorContent editor={editor} />
      {!editor ? <div className="min-h-[420px] px-8 py-6 text-sm text-muted">Loading the editor…</div> : null}
    </div>
  );
}
