/**
 * Pure helpers for document content (ProseMirror JSON as produced by the
 * editor): validation, merge fields and gap markers. No database access, so
 * they are shared by the services, the renderers and the tests.
 *
 * Merge fields look like {{client.fullName}}. Text still to be written looks
 * like [[Write the background here]]; AI drafts flag missing facts as
 * [[GAP: …]]. A document can't be finalised while either remains.
 */
import type { DocContent, DocNode } from "../../db/schema";

export const MERGE_FIELDS = {
  "client.fullName": "Client's full name",
  "client.firstName": "Client's first name",
  "client.lastName": "Client's last name",
  "client.ref": "Client reference",
  "client.email": "Client's email",
  "client.phone": "Client's phone",
  "client.nationality": "Client's nationality",
  "client.countryOfResidence": "Client's country of residence",
  "matter.ref": "Matter reference",
  "matter.title": "Matter title",
  "matter.legalCategory": "Legal category",
  "matter.jurisdiction": "Jurisdiction",
  "matter.submissionReference": "Submission reference",
  "firm.tradingName": "Practice name",
  "firm.legalName": "Practice legal name",
  "firm.contactEmail": "Practice email",
  "firm.contactPhone": "Practice phone",
  "firm.website": "Practice website",
  "user.name": "Your name",
  "user.email": "Your email",
  "document.ref": "Document reference",
  "today": "Today's date",
} as const;
export type MergeField = keyof typeof MERGE_FIELDS;
export type MergeValues = Partial<Record<MergeField, string | null | undefined>>;

const FIELD_RE = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g;
const GAP_RE = /\[\[([^\]]{1,300})\]\]/g;

const BLOCKS = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "horizontalRule"]);
const INLINE = new Set(["text", "hardBreak"]);
const MARKS = new Set(["bold", "italic", "underline", "strike", "link"]);

export const EMPTY_DOC: DocContent = { type: "doc", content: [{ type: "paragraph" }] };

export class ContentError extends Error {}

/** Check and clean editor output: only known nodes and marks, safe links, bounded size. */
export function sanitizeContent(raw: unknown): DocContent {
  if (!raw || typeof raw !== "object" || (raw as DocNode).type !== "doc") throw new ContentError("The document content couldn't be read.");
  let count = 0;
  const clean = (n: DocNode, depth: number): DocNode | null => {
    if (++count > 20_000 || depth > 12) throw new ContentError("The document is too large.");
    if (!n || typeof n !== "object" || typeof n.type !== "string") return null;
    if (n.type === "text") {
      if (typeof n.text !== "string" || !n.text) return null;
      const marks = (n.marks ?? [])
        .filter((m) => m && MARKS.has(m.type))
        .map((m) => {
          if (m.type !== "link") return { type: m.type };
          const href = String(m.attrs?.href ?? "");
          return /^(https?:|mailto:)/i.test(href) ? { type: "link", attrs: { href: href.slice(0, 2000) } } : null;
        })
        .filter((m): m is { type: string; attrs?: { href: string } } => !!m);
      return { type: "text", text: n.text.slice(0, 20_000), ...(marks.length ? { marks } : {}) };
    }
    if (n.type === "hardBreak") return { type: "hardBreak" };
    if (!BLOCKS.has(n.type)) return null;
    const out: DocNode = { type: n.type };
    if (n.type === "heading") out.attrs = { level: Math.min(3, Math.max(1, Number(n.attrs?.level) || 2)) };
    if (n.type === "orderedList" && n.attrs?.start && Number(n.attrs.start) > 1) out.attrs = { start: Math.floor(Number(n.attrs.start)) };
    if (Array.isArray(n.content)) {
      const kids = n.content.map((c) => clean(c, depth + 1)).filter((c): c is DocNode => !!c);
      if (kids.length) out.content = kids;
    }
    return out;
  };
  const content = ((raw as DocNode).content ?? []).map((c) => clean(c, 1)).filter((c): c is DocNode => !!c && (BLOCKS.has(c.type) || INLINE.has(c.type)));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

function walkText(nodes: DocNode[] | undefined, fn: (text: string) => void) {
  for (const n of nodes ?? []) {
    if (n.type === "text" && n.text) fn(n.text);
    walkText(n.content, fn);
  }
}

/** Plain text, one block per line (for search, checks and AI prompts). */
export function plainText(doc: DocContent): string {
  const lines: string[] = [];
  const block = (n: DocNode, prefix = "") => {
    if (n.type === "paragraph" || n.type === "heading") {
      let s = "";
      for (const c of n.content ?? []) s += c.type === "text" ? (c.text ?? "") : c.type === "hardBreak" ? "\n" : "";
      lines.push(prefix + s);
    } else if (n.type === "horizontalRule") lines.push("---");
    else if (n.type === "bulletList" || n.type === "orderedList") (n.content ?? []).forEach((li, i) => (li.content ?? []).forEach((c, j) => block(c, j === 0 ? (n.type === "bulletList" ? "• " : `${i + 1}. `) : "  ")));
    else for (const c of n.content ?? []) block(c, prefix);
  };
  for (const n of doc.content ?? []) block(n);
  return lines.join("\n").trim();
}

/** Merge fields used in the content, split into known and unknown names. */
export function mergeFieldsIn(doc: DocContent): { known: MergeField[]; unknown: string[] } {
  const known = new Set<MergeField>();
  const unknown = new Set<string>();
  walkText(doc.content, (t) => {
    for (const m of t.matchAll(FIELD_RE)) {
      if (m[1] in MERGE_FIELDS) known.add(m[1] as MergeField);
      else unknown.add(m[1]);
    }
  });
  return { known: [...known], unknown: [...unknown] };
}

/** Text still to be written ([[…]]) and merge fields not yet filled ({{…}}). */
export function gapsIn(doc: DocContent): { prompts: string[]; fields: string[] } {
  const prompts: string[] = [];
  const fields = new Set<string>();
  walkText(doc.content, (t) => {
    for (const m of t.matchAll(GAP_RE)) prompts.push(m[1].trim());
    for (const m of t.matchAll(FIELD_RE)) fields.add(m[1]);
  });
  return { prompts, fields: [...fields] };
}

/** Replace merge fields that have a value. Fields without one stay as {{…}} and are reported. */
export function fillMergeFields(doc: DocContent, values: MergeValues): { content: DocContent; missing: string[] } {
  const missing = new Set<string>();
  const map = (n: DocNode): DocNode => {
    if (n.type === "text" && n.text) {
      const text = n.text.replace(FIELD_RE, (whole, name: string) => {
        const v = values[name as MergeField];
        if (v === undefined || v === null || v === "") {
          missing.add(name);
          return whole;
        }
        return v;
      });
      return { ...n, text };
    }
    return n.content ? { ...n, content: n.content.map(map) } : n;
  };
  return { content: { type: "doc", content: (doc.content ?? []).map(map) }, missing: [...missing] };
}

/** Build simple content from paragraphs of text (used for AI drafts). Lines starting with "# " / "## " become headings, "- " bullets. */
export function contentFromText(text: string): DocContent {
  const content: DocNode[] = [];
  let bullets: DocNode[] = [];
  const flush = () => {
    if (bullets.length) content.push({ type: "bulletList", content: bullets });
    bullets = [];
  };
  for (const raw of text.replace(/\r/g, "").split(/\n{1,}/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      content.push({ type: "heading", attrs: { level: h[1].length }, content: [{ type: "text", text: h[2].replace(/\*\*/g, "") }] });
    } else if (/^[-*•]\s+/.test(line)) bullets.push({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: line.replace(/^[-*•]\s+/, "") }] }] });
    else {
      flush();
      content.push({ type: "paragraph", content: [{ type: "text", text: line.replace(/\*\*/g, "") }] });
    }
  }
  flush();
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export const longDate = (d: Date = new Date()) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" });
