import "server-only";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ProposalSnapshot } from "../../db/schema";

/**
 * Branded A4 proposal. Colours and cover follow each firm's approved design
 * (Veritas: soft black, magenta and gold; Mimshac: soft black and orange bar).
 * Uses the PDF standard fonts so rendering needs no network access.
 */
type Brand = { ink: string; accent: string; accent2: string; paper: string; cover: string; coverText: string; kicker: string; bar: boolean };

const BRANDS: Record<string, Brand> = {
  veritas: { ink: "#1d1b1a", accent: "#9e1f63", accent2: "#e6a930", paper: "#faf7f4", cover: "#0f0f0f", coverText: "#faf7f4", kicker: "CORPORATE · PRIVATE WEALTH · MIGRATION", bar: false },
  mimshac: { ink: "#272525", accent: "#e6a930", accent2: "#e6a930", paper: "#ffffff", cover: "#272525", coverText: "#ffffff", kicker: "IMMIGRATION · LEGAL · GLOBAL MOBILITY", bar: true },
};

function brandFor(s: ProposalSnapshot): Brand {
  return BRANDS[s.firm.slug] ?? { ink: "#24221f", accent: s.firm.brandColor, accent2: s.firm.brandColor, paper: "#ffffff", cover: "#24221f", coverText: "#ffffff", kicker: "IMMIGRATION AND GLOBAL MOBILITY", bar: true };
}

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100).replace(/ /g, " ");
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" });

function styles(b: Brand) {
  return StyleSheet.create({
    page: { backgroundColor: b.paper, color: b.ink, fontFamily: "Helvetica", fontSize: 10, lineHeight: 1.5, paddingTop: 56, paddingBottom: 64, paddingHorizontal: 56 },
    cover: { backgroundColor: b.cover, color: b.coverText, padding: 0, fontFamily: "Helvetica" },
    coverBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 14, backgroundColor: b.accent },
    coverInner: { flex: 1, paddingHorizontal: 64, paddingTop: 72, paddingBottom: 56, justifyContent: "space-between" },
    wordmark: { fontFamily: "Times-Roman", fontSize: 26, letterSpacing: 0.5 },
    kicker: { fontSize: 7.5, letterSpacing: 2, marginTop: 6, opacity: 0.8 },
    rule: { width: 54, height: 3, backgroundColor: b.accent2, marginVertical: 18 },
    coverTitle: { fontFamily: "Times-Roman", fontSize: 34, lineHeight: 1.15 },
    coverLede: { fontSize: 11, marginTop: 14, opacity: 0.85, maxWidth: 380 },
    strip: { flexDirection: "row", borderTopWidth: 0.6, borderTopColor: b.coverText, paddingTop: 12, gap: 24 },
    stripLabel: { fontSize: 7, letterSpacing: 1.4, opacity: 0.7 },
    stripValue: { fontSize: 10, marginTop: 3 },
    h2kicker: { fontSize: 7.5, letterSpacing: 1.8, color: b.accent, marginBottom: 4 },
    h2: { fontFamily: "Times-Roman", fontSize: 20, marginBottom: 10 },
    body: { fontSize: 10, marginBottom: 6 },
    section: { marginBottom: 22 },
    table: { borderTopWidth: 1, borderTopColor: b.ink, marginTop: 4 },
    row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#d9d4ce", paddingVertical: 7 },
    subRow: { flexDirection: "row", paddingVertical: 1.5, paddingLeft: 10 },
    cellLabel: { flex: 1, paddingRight: 10 },
    cellQty: { width: 34, textAlign: "right" },
    cellAmount: { width: 92, textAlign: "right" },
    muted: { color: "#6f6a64" },
    totalRow: { flexDirection: "row", borderTopWidth: 2, borderTopColor: b.accent2, paddingTop: 8, marginTop: 2 },
    depositBox: { marginTop: 14, padding: 12, borderLeftWidth: 3, borderLeftColor: b.accent, backgroundColor: "#f1ece6" },
    footer: { position: "absolute", left: 56, right: 56, bottom: 28, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#6f6a64", borderTopWidth: 0.5, borderTopColor: "#d9d4ce", paddingTop: 6 },
  });
}

function Footer({ s, st, b }: { s: ProposalSnapshot; st: ReturnType<typeof styles>; b: Brand }) {
  return (
    <View style={st.footer} fixed>
      <Text>{s.firm.tradingName} · A partner firm of Global Immigration Hub{s.firm.contactEmail ? ` · ${s.firm.contactEmail}` : ""}</Text>
      <Text render={({ pageNumber, totalPages }) => `${s.ref} v${s.version} · ${pageNumber} / ${totalPages}`} style={{ color: b.accent }} />
    </View>
  );
}

function Paragraphs({ text, style }: { text: string; style: object }) {
  return (
    <>
      {text.split(/\n{2,}/).map((para, i) => (
        <Text key={i} style={style}>{para.trim()}</Text>
      ))}
    </>
  );
}

export function ProposalDocument({ s, draft }: { s: ProposalSnapshot; draft?: boolean }) {
  const b = brandFor(s);
  const st = styles(b);
  const professional = s.items.map((i) => i.lines.filter((l) => l.kind === "professional").reduce((a, l) => a + l.amountMinor, 0) * i.quantity).reduce((a, x) => a + x, 0);
  const sections = s.sections.filter((x) => x.body.trim());
  return (
    <Document title={`${s.title} — ${s.ref}`} author={s.firm.tradingName} subject={`Proposal for ${s.recipientName}`} creator="GIH Operations Cloud">
      <Page size="A4" style={st.cover}>
        {b.bar ? <View style={st.coverBar} /> : null}
        <View style={st.coverInner}>
          <View>
            <Text style={st.wordmark}>{s.firm.tradingName}</Text>
            <Text style={st.kicker}>{b.kicker}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 8, letterSpacing: 2, color: b.accent2 }}>{draft ? "DRAFT · NOT SENT" : "PROPOSAL"}</Text>
            <View style={st.rule} />
            <Text style={st.coverTitle}>{s.title}</Text>
            <Text style={st.coverLede}>Prepared for {s.recipientName}. How we will handle your matter, what it costs, and how to begin.</Text>
          </View>
          <View>
            <View style={st.strip}>
              {[
                ["PREPARED FOR", s.recipientName],
                ["REFERENCE", `${s.ref} · v${s.version}`],
                ["DATE", longDate(s.releasedAt)],
                ["VALID UNTIL", longDate(s.validUntil)],
              ].map(([k, v]) => (
                <View key={k}>
                  <Text style={st.stripLabel}>{k}</Text>
                  <Text style={st.stripValue}>{v}</Text>
                </View>
              ))}
            </View>
            <Text style={{ fontSize: 7.5, marginTop: 14, opacity: 0.7 }}>A partner firm of Global Immigration Hub{s.preparedBy ? ` · Prepared by ${s.preparedBy}` : ""}</Text>
          </View>
        </View>
      </Page>

      <Page size="A4" style={st.page}>
        {sections.map((sec, i) => (
          <View key={sec.key} style={st.section} wrap>
            <Text style={st.h2kicker}>{String(i + 1).padStart(2, "0")}</Text>
            <Text style={st.h2}>{sec.title}</Text>
            <Paragraphs text={sec.body} style={st.body} />
          </View>
        ))}
        <Footer s={s} st={st} b={b} />
      </Page>

      <Page size="A4" style={st.page}>
        <Text style={st.h2kicker}>YOUR INVESTMENT</Text>
        <Text style={st.h2}>Fees</Text>
        <View style={st.table}>
          <View style={[st.row, { borderBottomColor: b.ink }]}>
            <Text style={[st.cellLabel, { fontFamily: "Helvetica-Bold", fontSize: 8.5 }]}>Item</Text>
            <Text style={[st.cellQty, { fontFamily: "Helvetica-Bold", fontSize: 8.5 }]}>Qty</Text>
            <Text style={[st.cellAmount, { fontFamily: "Helvetica-Bold", fontSize: 8.5 }]}>Amount</Text>
          </View>
          {s.items.map((it, i) => (
            <View key={i} style={st.row} wrap={false}>
              <View style={st.cellLabel}>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{it.label}</Text>
                {it.description ? <Text style={st.muted}>{it.description}</Text> : null}
                {it.lines.length > 1
                  ? it.lines.map((l) => (
                      <View key={l.label} style={st.subRow}>
                        <Text style={[st.cellLabel, st.muted, { fontSize: 8.5 }]}>{l.label}</Text>
                        <Text style={[st.muted, { fontSize: 8.5 }]}>{money(l.amountMinor, s.currency)}</Text>
                      </View>
                    ))
                  : null}
              </View>
              <Text style={st.cellQty}>{it.quantity}</Text>
              <Text style={st.cellAmount}>{money(it.unitMinor * it.quantity, s.currency)}</Text>
            </View>
          ))}
          <View style={st.totalRow}>
            <Text style={[st.cellLabel, { fontFamily: "Helvetica-Bold" }]}>Total</Text>
            <Text style={[st.cellAmount, { fontFamily: "Helvetica-Bold", fontSize: 12 }]}>{money(s.totalMinor, s.currency)}</Text>
          </View>
        </View>
        {professional > 0 && professional < s.totalMinor ? (
          <Text style={[st.muted, { fontSize: 8.5, marginTop: 8 }]}>
            Our professional fees are {money(professional, s.currency)}. The rest is government, VFS and third-party costs, charged at cost.
          </Text>
        ) : null}
        <View style={st.depositBox}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>To begin: {money(s.depositMinor, s.currency)} deposit</Text>
          <Text style={{ marginTop: 3 }}>The balance of {money(s.totalMinor - s.depositMinor, s.currency)} is due before submission. This proposal is valid until {longDate(s.validUntil)}.</Text>
        </View>
        <View style={{ marginTop: 28 }}>
          <Text style={st.h2kicker}>CONTACT</Text>
          <Text>{s.firm.legalName}</Text>
          {s.firm.contactEmail ? <Text>{s.firm.contactEmail}</Text> : null}
          {s.firm.contactPhone ? <Text>{s.firm.contactPhone}</Text> : null}
          {s.firm.website ? <Text>{s.firm.website}</Text> : null}
          <Text style={[st.muted, { marginTop: 6 }]}>Global Immigration Hub centres: Pretoria (115 Paul Kruger Street, New Court Chambers) · Harare (Office 2, 12th Floor, Joina City)</Text>
        </View>
        <Footer s={s} st={st} b={b} />
      </Page>
    </Document>
  );
}

export async function renderProposalPdf(s: ProposalSnapshot, draft = false): Promise<Buffer> {
  return renderToBuffer(<ProposalDocument s={s} draft={draft} />);
}

export function pdfFileName(s: ProposalSnapshot) {
  const safe = (x: string) => x.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, " ");
  return `${safe(s.recipientName)} - ${s.ref} v${s.version}.pdf`;
}
