import "server-only";
import { Document as PdfDocument, Link, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  AlignmentType, BorderStyle, Document as DocxDocument, ExternalHyperlink, Footer, Header, HeadingLevel, LevelFormat, Packer, PageNumber, Paragraph, TextRun,
} from "docx";
import type { DocContent, DocNode } from "../../db/schema";

/**
 * Exports a document as an A4 PDF or a Word file, on the practice's letterhead
 * (name, contact details, brand colour), with headers, footers and page
 * numbers. Drafts are marked as drafts on every page.
 */
export type Letterhead = {
  tradingName: string; legalName: string; slug: string; brandColor: string; contactEmail: string | null; contactPhone: string | null; website: string | null;
  address: string | null; registrationNumber: string | null;
};
export type RenderInput = { title: string; ref: string; version: number | null; final: boolean; letterhead: Letterhead | null; content: DocContent };

const ACCENT: Record<string, string> = { veritas: "#9e1f63", mimshac: "#c48a14", nextmove: "#1f6f6a" };
const accentFor = (l: Letterhead | null) => (l ? (ACCENT[l.slug] ?? l.brandColor) : "#1b263b");
const contactLine = (l: Letterhead) => [l.address?.replace(/\n+/g, ", "), l.contactEmail, l.contactPhone, l.website].filter(Boolean).join("  |  ");
const footerLabel = (d: RenderInput) => `${d.ref}${d.version ? ` v${d.version}` : ""}${d.final ? "" : "  |  DRAFT"}`;

/* ───────── PDF ───────── */

// No lineHeight on the page itself: react-pdf 4.x then drops page numbers.
const st = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10.5, color: "#1d2230", paddingTop: 108, paddingBottom: 72, paddingHorizontal: 64 },
  head: { position: "absolute", top: 36, left: 64, right: 64, borderBottomWidth: 1.5, paddingBottom: 10 },
  wordmark: { fontFamily: "Times-Roman", fontSize: 20, lineHeight: 1.2 },
  headSmall: { fontSize: 7.5, color: "#5f6575", marginTop: 2 },
  p: { lineHeight: 1.35, marginBottom: 7 },
  h1: { fontFamily: "Times-Roman", fontSize: 20, lineHeight: 1.25, marginTop: 6, marginBottom: 10 },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 13, lineHeight: 1.3, marginTop: 10, marginBottom: 6 },
  h3: { fontFamily: "Helvetica-Bold", fontSize: 11, lineHeight: 1.3, marginTop: 8, marginBottom: 4 },
  li: { flexDirection: "row", marginBottom: 0 },
  bullet: { width: 18, lineHeight: 1.35 },
  liBody: { flex: 1 },
  quote: { borderLeftWidth: 2, borderLeftColor: "#d3ccbf", paddingLeft: 10, marginBottom: 8, color: "#4a5162" },
  hr: { borderBottomWidth: 0.6, borderBottomColor: "#d3ccbf", marginVertical: 10 },
  footer: { position: "absolute", left: 64, right: 64, bottom: 32, fontSize: 7.5, color: "#5f6575", borderTopWidth: 0.5, borderTopColor: "#d3ccbf", paddingTop: 6 },
  pageNo: { position: "absolute", left: 64, right: 64, bottom: 32, paddingTop: 6, fontSize: 7.5, textAlign: "right" },
  draft: { position: "absolute", top: 330, left: 110, fontSize: 80, color: "#c9302c", opacity: 0.08, transform: "rotate(-30deg)", fontFamily: "Helvetica-Bold" },
});

function runs(nodes: DocNode[] | undefined, accent: string) {
  return (nodes ?? []).map((n, i) => {
    if (n.type === "hardBreak") return <Text key={i}>{"\n"}</Text>;
    if (n.type !== "text") return null;
    const marks = new Set((n.marks ?? []).map((m) => m.type));
    const bold = marks.has("bold");
    const italic = marks.has("italic");
    const style = {
      fontFamily: bold && italic ? "Helvetica-BoldOblique" : bold ? "Helvetica-Bold" : italic ? "Helvetica-Oblique" : undefined,
      textDecoration: marks.has("underline") ? ("underline" as const) : marks.has("strike") ? ("line-through" as const) : undefined,
    };
    const href = (n.marks ?? []).find((m) => m.type === "link")?.attrs?.href as string | undefined;
    return href ? <Link key={i} src={href} style={{ ...style, color: accent }}>{n.text}</Link> : <Text key={i} style={style}>{n.text}</Text>;
  });
}

function pdfBlocks(nodes: DocNode[] | undefined, accent: string): React.ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    switch (n.type) {
      case "heading": {
        const level = Number(n.attrs?.level) || 2;
        return <Text key={i} style={[level === 1 ? st.h1 : level === 2 ? st.h2 : st.h3, level === 2 ? { color: accent } : {}]} minPresenceAhead={40}>{runs(n.content, accent)}</Text>;
      }
      case "bulletList":
      case "orderedList":
        return (
          <View key={i} style={{ marginBottom: 6 }}>
            {(n.content ?? []).map((li, j) => (
              <View key={j} style={st.li} wrap={false}>
                <Text style={st.bullet}>{n.type === "bulletList" ? "•" : `${(Number(n.attrs?.start) || 1) + j}.`}</Text>
                <View style={st.liBody}>{pdfBlocks(li.content, accent)}</View>
              </View>
            ))}
          </View>
        );
      case "blockquote":
        return <View key={i} style={st.quote}>{pdfBlocks(n.content, accent)}</View>;
      case "horizontalRule":
        return <View key={i} style={st.hr} />;
      case "paragraph":
        return <Text key={i} style={st.p}>{n.content?.length ? runs(n.content, accent) : " "}</Text>;
      default:
        return null;
    }
  });
}

export function DocumentPdf({ d }: { d: RenderInput }) {
  const accent = accentFor(d.letterhead);
  const l = d.letterhead;
  return (
    <PdfDocument title={`${d.title} — ${d.ref}`} author={l?.tradingName ?? "Global Immigration Hub"} creator="GIH Operations Cloud">
      <Page size="A4" style={[st.page, l ? {} : { paddingTop: 64 }]}>
        {l ? (
          <View style={[st.head, { borderBottomColor: accent }]} fixed>
            <Text style={[st.wordmark, { color: accent }]}>{l.tradingName}</Text>
            <Text style={st.headSmall}>{[l.legalName !== l.tradingName ? l.legalName : null, l.registrationNumber ? `Registration ${l.registrationNumber}` : null].filter(Boolean).join("  |  ") || " "}</Text>
          </View>
        ) : null}
        {!d.final ? <Text style={st.draft} fixed>DRAFT</Text> : null}
        {pdfBlocks(d.content.content, accent)}
        <View style={st.footer} fixed>
          <Text style={{ maxWidth: 360 }}>{l ? contactLine(l) || l.tradingName : " "}</Text>
        </View>
        <Text style={[st.pageNo, { color: accent }]} fixed render={({ pageNumber, totalPages }) => `${footerLabel(d)}  |  ${pageNumber} / ${totalPages}`} />
      </Page>
    </PdfDocument>
  );
}

export async function renderDocumentPdf(d: RenderInput): Promise<Buffer> {
  return renderToBuffer(<DocumentPdf d={d} />);
}

/* ───────── Word ───────── */

function docxRuns(nodes: DocNode[] | undefined, accent: string): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") out.push(new TextRun({ break: 1 }));
    if (n.type !== "text" || !n.text) continue;
    const marks = new Set((n.marks ?? []).map((m) => m.type));
    const opts = { text: n.text, bold: marks.has("bold") || undefined, italics: marks.has("italic") || undefined, underline: marks.has("underline") ? {} : undefined, strike: marks.has("strike") || undefined };
    const href = (n.marks ?? []).find((m) => m.type === "link")?.attrs?.href as string | undefined;
    out.push(href ? new ExternalHyperlink({ link: href, children: [new TextRun({ ...opts, color: accent.replace("#", ""), underline: {} })] }) : new TextRun(opts));
  }
  return out;
}

function docxBlocks(nodes: DocNode[] | undefined, accent: string, list?: { ref: string; level: number }): Paragraph[] {
  const out: Paragraph[] = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case "heading": {
        const level = Number(n.attrs?.level) || 2;
        out.push(new Paragraph({ heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: docxRuns(n.content, accent) }));
        break;
      }
      case "paragraph":
        out.push(new Paragraph({ children: docxRuns(n.content, accent), ...(list ? { numbering: { reference: list.ref, level: list.level } } : {}), spacing: { after: 120, line: 300 } }));
        break;
      case "bulletList":
      case "orderedList":
        for (const li of n.content ?? []) {
          const [first, ...rest] = li.content ?? [];
          if (first) out.push(...docxBlocks([first], accent, { ref: n.type === "bulletList" ? "bullets" : "numbers", level: list ? Math.min(list.level + 1, 2) : 0 }));
          out.push(...docxBlocks(rest, accent, list));
        }
        break;
      case "blockquote":
        out.push(...docxBlocks(n.content, accent).map((p) => p));
        break;
      case "horizontalRule":
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D3CCBF", space: 1 } }, children: [] }));
        break;
    }
  }
  return out;
}

export async function renderDocumentDocx(d: RenderInput): Promise<Buffer> {
  const accent = accentFor(d.letterhead);
  const l = d.letterhead;
  const header = new Header({
    children: l
      ? [
          new Paragraph({ children: [new TextRun({ text: l.tradingName, font: "Times New Roman", size: 36, color: accent.replace("#", "") })] }),
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: accent.replace("#", ""), space: 4 } },
            children: [new TextRun({ text: [l.legalName !== l.tradingName ? l.legalName : null, l.registrationNumber ? `Registration ${l.registrationNumber}` : null].filter(Boolean).join("  |  "), size: 15, color: "5F6575" })],
          }),
        ]
      : [],
  });
  const footer = new Footer({
    children: [
      ...(l ? [new Paragraph({ children: [new TextRun({ text: contactLine(l), size: 15, color: "5F6575" })] })] : []),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: `${footerLabel(d)}  |  `, size: 15, color: accent.replace("#", "") }), new TextRun({ children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES], size: 15, color: accent.replace("#", "") })],
      }),
    ],
  });
  const doc = new DocxDocument({
    creator: "GIH Operations Cloud",
    title: `${d.title} — ${d.ref}`,
    styles: {
      default: { document: { run: { font: "Arial", size: 21, color: "1D2230" } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { font: "Times New Roman", size: 40 }, paragraph: { spacing: { before: 120, after: 200 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { bold: true, size: 26, color: accent.replace("#", "") }, paragraph: { spacing: { before: 200, after: 120 } } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", run: { bold: true, size: 22 }, paragraph: { spacing: { before: 160, after: 80 } } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [0, 1, 2].map((level) => ({ level, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } } })) },
        { reference: "numbers", levels: [0, 1, 2].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } } })) },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1700, bottom: 1300, left: 1280, right: 1280, header: 600, footer: 500 } } },
        headers: { default: header },
        footers: { default: footer },
        children: [
          ...(!d.final ? [new Paragraph({ children: [new TextRun({ text: "DRAFT — not for sending", bold: true, color: "C9302C", size: 16 })] })] : []),
          ...docxBlocks(d.content.content, accent),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export function exportFileName(d: { title: string; ref: string; version: number | null }, ext: "pdf" | "docx") {
  const safe = (x: string) => x.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, " ").slice(0, 80);
  return `${safe(d.title)} - ${d.ref}${d.version ? ` v${d.version}` : ""}.${ext}`;
}
