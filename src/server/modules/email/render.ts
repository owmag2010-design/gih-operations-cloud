/**
 * Branded email rendering. Pure functions (no I/O) so they can be unit-tested
 * and used for the live preview in the template editor.
 *
 * Layouts follow the approved designs. Gmail strips background colours on many
 * clients, so structure relies on borders and text colour; the header bar is a
 * table cell with a solid colour, which Gmail keeps.
 */
import type { EmailBlock } from "../../db/schema";

export type EmailBrandKey = "hub" | "veritas" | "mimshac" | "nextmove" | "firm";

export type EmailBrand = {
  key: EmailBrandKey;
  name: string;
  tagline: string;
  ink: string;
  accent: string;
  rule: string;
  headerBg: string;
  headerText: string;
  logoUrl: string | null;
  footer: string;
};

export function brandFor(firm: { slug: string; tradingName: string; brandColor: string } | null, appUrl: string): EmailBrand {
  const hubFooter = "Global Immigration Hub · Pretoria · Harare · Sydney · thegih.com";
  if (!firm) {
    return { key: "hub", name: "Global Immigration Hub", tagline: "One front door for immigration", ink: "#202326", accent: "#dd1929", rule: "#dd1929", headerBg: "#1b263b", headerText: "#ffffff", logoUrl: `${appUrl}/brand/gih-logo-horizontal-white.png`, footer: hubFooter };
  }
  const partner = `${firm.tradingName} · A partner firm of Global Immigration Hub`;
  if (firm.slug === "veritas") return { key: "veritas", name: "Veritas Emigrate", tagline: "Corporate · Private wealth · Migration", ink: "#1d1b1a", accent: "#9e1f63", rule: "#e6a930", headerBg: "#0f0f0f", headerText: "#faf7f4", logoUrl: null, footer: partner };
  if (firm.slug === "mimshac") return { key: "mimshac", name: "Mimshac Group", tagline: "Partner firm of Global Immigration Hub", ink: "#272525", accent: "#e6a930", rule: "#e6a930", headerBg: "#272525", headerText: "#ffffff", logoUrl: null, footer: partner };
  return { key: "firm", name: firm.tradingName, tagline: "Partner firm of Global Immigration Hub", ink: "#202326", accent: firm.brandColor, rule: firm.brandColor, headerBg: "#1b263b", headerText: "#ffffff", logoUrl: null, footer: partner };
}

/** Merge fields people can use in subjects and blocks, e.g. {{first_name}}. */
export const MERGE_FIELDS = {
  first_name: "Client first name",
  full_name: "Client full name",
  email: "Client email",
  reference: "Lead or client reference",
  firm_name: "Firm name",
  sender_name: "Your name",
  sender_email: "Your sending address",
  today: "Today's date",
} as const;
export type MergeValues = Partial<Record<keyof typeof MERGE_FIELDS, string>>;

/** Replace {{field}} placeholders. Unknown fields are left visible so mistakes are caught in preview. */
export function merge(text: string, values: MergeValues): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) => {
    const v = values[key as keyof MergeValues];
    return v === undefined || v === null ? m : v;
  });
}

export function unknownFields(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) if (!(m[1] in MERGE_FIELDS)) out.add(m[1]);
  return [...out];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Paragraph text: escape, then turn blank lines into breaks and **bold** into <strong>. */
function inline(text: string) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const FONT = "Arial,Helvetica,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

function blockHtml(b: EmailBlock, brand: EmailBrand): string {
  switch (b.type) {
    case "heading":
      return `<h1 style="margin:0 0 14px;font-family:${SERIF};font-size:24px;line-height:1.25;font-weight:normal;color:${brand.ink}">${esc(b.text)}</h1>`;
    case "paragraph":
      return b.text
        .split(/\n{2,}/)
        .map((p) => `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:${brand.ink}">${inline(p)}</p>`)
        .join("");
    case "button": {
      const url = safeUrl(b.url);
      if (!url) return "";
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td style="border-radius:6px;background:${brand.headerBg};border:1px solid ${brand.headerBg}"><a href="${esc(url)}" style="display:inline-block;padding:12px 20px;font-family:${FONT};font-size:14px;font-weight:bold;color:${brand.headerText};text-decoration:none">${esc(b.label)} &rarr;</a></td></tr></table>`;
    }
    case "details":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border-top:1px solid #e6e7e5">${b.rows
        .map((r) => `<tr><td style="padding:9px 0;border-bottom:1px solid #e6e7e5;font-family:${FONT};font-size:13px;color:#60666b;width:40%">${esc(r.label)}</td><td style="padding:9px 0;border-bottom:1px solid #e6e7e5;font-family:${FONT};font-size:14px;color:${brand.ink};text-align:right">${inline(r.value)}</td></tr>`)
        .join("")}</table>`;
    case "notice":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px"><tr><td style="border-left:3px solid ${brand.accent};padding:10px 14px;font-family:${FONT};font-size:14px;line-height:1.55;color:${brand.ink}">${inline(b.text)}</td></tr></table>`;
    case "divider":
      return `<hr style="border:0;border-top:1px solid #e6e7e5;margin:20px 0">`;
  }
}

function blockText(b: EmailBlock): string {
  switch (b.type) {
    case "heading":
      return b.text.toUpperCase();
    case "paragraph":
      return b.text.replace(/\*\*(.+?)\*\*/g, "$1");
    case "button":
      return `${b.label}: ${b.url}`;
    case "details":
      return b.rows.map((r) => `${r.label}: ${r.value}`).join("\n");
    case "notice":
      return `> ${b.text}`;
    case "divider":
      return "----";
  }
}

export function mergeBlocks(blocks: EmailBlock[], values: MergeValues): EmailBlock[] {
  return blocks.map((b) => {
    switch (b.type) {
      case "heading":
      case "paragraph":
      case "notice":
        return { ...b, text: merge(b.text, values) };
      case "button":
        return { ...b, label: merge(b.label, values), url: merge(b.url, values) };
      case "details":
        return { ...b, rows: b.rows.map((r) => ({ label: merge(r.label, values), value: merge(r.value, values) })) };
      default:
        return b;
    }
  });
}

export type RenderInput = { brand: EmailBrand; subject: string; preheader?: string | null; blocks: EmailBlock[]; signature?: string | null; values?: MergeValues; reference?: string | null };

export function renderEmail(input: RenderInput): { subject: string; html: string; text: string } {
  const values = input.values ?? {};
  const subject = merge(input.subject, values).replace(/[\r\n]+/g, " ").trim();
  const blocks = mergeBlocks(input.blocks, values);
  const signature = input.signature ? merge(input.signature, values) : null;
  const b = input.brand;
  const preheader = input.preheader ? merge(input.preheader, values) : "";

  const header = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" width="220" alt="${esc(b.name)}" style="display:block;border:0;height:auto;max-width:220px">`
    : `<div style="font-family:${SERIF};font-size:22px;color:${b.headerText}">${esc(b.name)}</div><div style="margin-top:4px;font-family:${FONT};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${b.headerText};opacity:.75">${esc(b.tagline)}</div>`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f2ee">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ee"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e6e7e5">
<tr><td style="background:${b.headerBg};padding:26px 32px;border-bottom:4px solid ${b.rule}">${header}</td></tr>
<tr><td style="padding:32px 32px 12px">
${input.reference ? `<p style="margin:0 0 18px;font-family:${FONT};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${b.accent}">${esc(input.reference)}</p>` : ""}
${blocks.map((x) => blockHtml(x, b)).join("\n")}
${signature ? `<p style="margin:22px 0 6px;font-family:${FONT};font-size:14px;line-height:1.55;color:${b.ink}">${inline(signature)}</p>` : ""}
</td></tr>
<tr><td style="padding:18px 32px 26px;border-top:1px solid #e6e7e5;font-family:${FONT};font-size:11px;line-height:1.6;color:#60666b">${esc(b.footer)}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [input.reference ?? "", ...blocks.map(blockText), signature ?? "", "--", b.footer].filter(Boolean).join("\n\n");
  return { subject, html, text };
}

/** Plain message typed in the dashboard (no template): paragraphs only. */
export function plainBlocks(body: string): EmailBlock[] {
  return [{ type: "paragraph", text: body.trim() }];
}
