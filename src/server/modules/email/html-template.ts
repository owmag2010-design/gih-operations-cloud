/**
 * Imported HTML email templates: sanitising, tokens, rendering and the plain
 * text alternative. Pure functions (no I/O), unit-tested.
 *
 * Tokens in a template:
 *   {{first_name}}   a merge field (see MERGE_FIELDS)
 *   {{edit:intro}}   an editable slot: staff fill it in when composing
 *   {{signature}}    where the sender's signature goes (added at the end if absent)
 */
import sanitizeHtml from "sanitize-html";
import { MERGE_FIELDS, type MergeValues } from "./render";

const TAGS = [
  "html", "head", "body", "meta", "title", "style",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col", "caption",
  "div", "span", "p", "br", "hr", "center", "font", "blockquote", "pre", "code",
  "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "small", "sup", "sub",
  "ul", "ol", "li", "a", "img",
];

const COMMON = ["style", "class", "id", "align", "valign", "width", "height", "bgcolor", "border", "dir", "lang", "role", "title", "aria-label", "aria-hidden"];

/** Remove anything that could run code or phone home in ways we don't allow. Keeps the email design. */
export function sanitizeTemplateHtml(html: string): string {
  const clean = sanitizeHtml(html, {
    allowedTags: TAGS,
    allowVulnerableTags: true, // <style> is needed for email media queries; scripts are still removed
    allowedAttributes: {
      "*": COMMON,
      table: [...COMMON, "cellpadding", "cellspacing", "summary"],
      td: [...COMMON, "colspan", "rowspan", "nowrap"],
      th: [...COMMON, "colspan", "rowspan", "scope"],
      col: [...COMMON, "span"],
      a: [...COMMON, "href", "target", "rel", "name"],
      img: [...COMMON, "src", "alt"],
      meta: ["charset", "name", "content", "http-equiv"],
      font: [...COMMON, "color", "face", "size"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "cid"] },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    // meta http-equiv="refresh" could redirect a reader.
    exclusiveFilter: (frame) => frame.tag === "meta" && /refresh/i.test(frame.attribs["http-equiv"] ?? ""),
  });
  // CSS that can load or execute things.
  return clean
    .replace(/expression\s*\(/gi, "blocked(")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*['"]?\s*(?!https:)[^)]*\)/gi, "none")
    .replace(/javascript\s*:/gi, "blocked:");
}

export type TemplateTokens = { fields: string[]; unknownFields: string[]; slots: string[]; hasSignature: boolean };

export function templateTokens(...texts: (string | null | undefined)[]): TemplateTokens {
  const fields = new Set<string>();
  const unknown = new Set<string>();
  const slots = new Set<string>();
  let hasSignature = false;
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/\{\{\s*([a-z_]+)(?::([a-z_]+))?\s*\}\}/g)) {
      if (m[1] === "edit" && m[2]) slots.add(m[2]);
      else if (m[1] === "signature" && !m[2]) hasSignature = true;
      else if (m[1] in MERGE_FIELDS) fields.add(m[1]);
      else unknown.add(m[2] ? `${m[1]}:${m[2]}` : m[1]);
    }
  }
  return { fields: [...fields], unknownFields: [...unknown], slots: [...slots], hasSignature };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Slot text typed by staff: escaped, paragraphs kept, **bold** allowed, links made clickable. */
export function slotHtml(text: string): string {
  return esc(text.trim())
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:inherit">$1</a>')
    .replace(/\n{2,}/g, "<br><br>")
    .replace(/\n/g, "<br>");
}

/** Merge values in HTML are escaped; in subjects and text they are not. */
function fillFields(s: string, values: MergeValues, escape: boolean) {
  return s.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) => {
    if (key === "signature") return m;
    const v = values[key as keyof MergeValues];
    if (v === undefined || v === null || v === "") return m;
    return escape ? esc(v) : v;
  });
}

/** Turn email HTML into a readable plain-text alternative. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|title|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<div[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<a\s[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const l = label.replace(/<[^>]+>/g, "").trim();
      return l && l !== href ? `${l} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|table|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/t[dh]>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&rarr;/g, "→")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type HtmlRenderInput = {
  html: string;
  subject: string;
  preheader?: string | null;
  values: MergeValues;
  slots: Record<string, string>;
  slotDefaults?: Record<string, string>;
  signatureHtml?: string | null;
  signatureText?: string | null;
  textOverride?: string | null;
};

export type RenderResult = { subject: string; html: string; text: string; missingFields: string[]; emptySlots: string[] };

export function renderHtmlTemplate(input: HtmlRenderInput): RenderResult {
  const tokens = templateTokens(input.html, input.subject, input.preheader, input.textOverride);
  const missingFields = tokens.fields.filter((f) => !input.values[f as keyof MergeValues]);
  const emptySlots = tokens.slots.filter((s) => !(input.slots[s] ?? "").trim());

  let html = input.html;
  html = html.replace(/\{\{\s*edit:([a-z_]+)\s*\}\}/g, (_m, key: string) => slotHtml(input.slots[key] ?? ""));
  html = fillFields(html, input.values, true);
  if (input.signatureHtml) {
    if (/\{\{\s*signature\s*\}\}/.test(html)) html = html.replace(/\{\{\s*signature\s*\}\}/g, input.signatureHtml);
    else if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${input.signatureHtml}</body>`);
    else html += input.signatureHtml;
  } else {
    html = html.replace(/\{\{\s*signature\s*\}\}/g, "");
  }
  if (input.preheader && !/display\s*:\s*none/i.test(html.slice(0, 2000))) {
    const pre = `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(fillFields(input.preheader, input.values, false))}</div>`;
    html = /<body[^>]*>/i.test(html) ? html.replace(/(<body[^>]*>)/i, `$1${pre}`) : pre + html;
  }
  // Sanitise last, so merged values (e.g. a link) are checked too.
  html = sanitizeTemplateHtml(html);

  const subject = fillFields(input.subject, input.values, false).replace(/[\r\n]+/g, " ").trim();
  let text: string;
  if (input.textOverride?.trim()) {
    text = fillFields(input.textOverride, input.values, false).replace(/\{\{\s*edit:([a-z_]+)\s*\}\}/g, (_m, k: string) => input.slots[k] ?? "");
    text = text.replace(/\{\{\s*signature\s*\}\}/g, input.signatureText ?? "");
  } else {
    text = htmlToText(html);
  }
  return { subject, html, text, missingFields, emptySlots };
}
