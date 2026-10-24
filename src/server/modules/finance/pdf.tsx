import "server-only";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { PrintedDetails } from "./finance";

/**
 * Branded A4 invoice (and draft preview). Practice details come from the copy
 * taken at issue, so later changes to billing settings don't alter issued
 * invoices. Uses the PDF standard fonts so rendering needs no network access.
 */
type Brand = { ink: string; accent: string; accent2: string; band: string; bandText: string };

const BRANDS: Record<string, Brand> = {
  veritas: { ink: "#1d1b1a", accent: "#9e1f63", accent2: "#e6a930", band: "#0f0f0f", bandText: "#faf7f4" },
  mimshac: { ink: "#272525", accent: "#e6a930", accent2: "#e6a930", band: "#272525", bandText: "#ffffff" },
  nextmove: { ink: "#1f2a2a", accent: "#1f6f6a", accent2: "#3aa6a0", band: "#ffffff", bandText: "#1f2a2a" },
};

const brandFor = (p: PrintedDetails): Brand => BRANDS[p.slug] ?? { ink: "#1b263b", accent: p.brandColor, accent2: p.brandColor, band: "#1b263b", bandText: "#ffffff" };

export type InvoicePdfInput = {
  printed: PrintedDetails;
  invoice: {
    number: string | null; status: string; display: string; currency: string; issueDate: string | null; dueDate: string | null; billToName: string; billToEmail: string | null; billToAddress: string | null;
    reference: string | null; terms: string | null; notes: string | null; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; paidMinor: number; creditedMinor: number; taxRateBp: number | null; voidReason: string | null;
  };
  lines: { kind: string; description: string; quantity: number; unitMinor: number; totalMinor: number }[];
  clientRef: string | null;
  matterRef: string | null;
};

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100).replace(/ /g, " ");
const longDate = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "On issue");

const KIND: Record<string, string> = { professional: "Professional fee", government: "Government fee (at cost)", third_party: "Third-party cost (at cost)", disbursement: "Disbursement", discount: "Discount" };

function styles(b: Brand) {
  return StyleSheet.create({
    // No lineHeight on the page: with it, react-pdf 4.x drops the page numbers.
    page: { color: b.ink, fontFamily: "Helvetica", fontSize: 9.5, paddingBottom: 64 },
    band: { backgroundColor: b.band, color: b.bandText, paddingHorizontal: 48, paddingTop: 36, paddingBottom: 26, flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 4, borderBottomColor: b.accent },
    wordmark: { fontFamily: "Times-Roman", fontSize: 22, lineHeight: 1.2, marginBottom: 4 },
    small: { fontSize: 8, opacity: 0.85 },
    title: { fontSize: 8, letterSpacing: 2.2, color: b.accent2, textAlign: "right" },
    number: { fontFamily: "Times-Roman", fontSize: 20, lineHeight: 1.2, textAlign: "right", marginTop: 2 },
    body: { paddingHorizontal: 48, paddingTop: 24 },
    meta: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 },
    label: { fontSize: 7, letterSpacing: 1.4, color: "#6f6a64", marginBottom: 3 },
    table: { borderTopWidth: 1, borderTopColor: b.ink },
    row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#d9d4ce", paddingVertical: 6 },
    head: { fontFamily: "Helvetica-Bold", fontSize: 8 },
    cDesc: { flex: 1, paddingRight: 8 },
    cQty: { width: 30, textAlign: "right" },
    cUnit: { width: 80, textAlign: "right" },
    cAmt: { width: 86, textAlign: "right" },
    muted: { color: "#6f6a64" },
    totals: { alignSelf: "flex-end", width: 240, marginTop: 10 },
    tRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
    tTotal: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 2, borderTopColor: b.accent2, paddingTop: 6, marginTop: 4 },
    box: { marginTop: 22, padding: 12, borderLeftWidth: 3, borderLeftColor: b.accent, backgroundColor: "#f4f1ec" },
    stamp: { position: "absolute", top: 300, left: 120, fontSize: 64, color: "#c9302c", opacity: 0.12, transform: "rotate(-24deg)", fontFamily: "Helvetica-Bold" },
    footer: { position: "absolute", left: 48, right: 48, bottom: 26, fontSize: 7, color: "#6f6a64", borderTopWidth: 0.5, borderTopColor: "#d9d4ce", paddingTop: 6 },
    pageNo: { position: "absolute", left: 48, right: 48, bottom: 26, paddingTop: 6, fontSize: 7, color: b.accent, textAlign: "right" },
  });
}

export function InvoiceDocument({ d }: { d: InvoicePdfInput }) {
  const p = d.printed;
  const inv = d.invoice;
  const b = brandFor(p);
  const st = styles(b);
  const draft = inv.status === "draft";
  const balance = Math.max(0, inv.totalMinor - inv.paidMinor - inv.creditedMinor);
  const heading = draft ? "DRAFT INVOICE" : p.taxNumber && inv.taxMinor > 0 ? "TAX INVOICE" : "INVOICE";
  const stamp = draft ? "DRAFT" : inv.status === "void" ? "VOID" : inv.status === "paid" ? "PAID" : inv.status === "credited" ? "CREDITED" : null;
  return (
    <Document title={`${inv.number ?? "Draft invoice"} — ${inv.billToName}`} author={p.tradingName} subject={`Invoice for ${inv.billToName}`} creator="GIH Operations Cloud">
      <Page size="A4" style={st.page}>
        <View style={st.band} fixed>
          <View>
            <Text style={st.wordmark}>{p.tradingName}</Text>
            <Text style={st.small}>{p.legalName}</Text>
            {p.registrationNumber ? <Text style={st.small}>Registration {p.registrationNumber}</Text> : null}
            {p.taxNumber ? <Text style={st.small}>{p.taxLabel ?? "VAT"} number {p.taxNumber}</Text> : null}
          </View>
          <View>
            <Text style={st.title}>{heading}</Text>
            <Text style={st.number}>{inv.number ?? "Not yet numbered"}</Text>
          </View>
        </View>
        {stamp ? <Text style={st.stamp} fixed>{stamp}</Text> : null}

        <View style={st.body}>
          <View style={st.meta}>
            <View style={{ width: 220 }}>
              <Text style={st.label}>BILL TO</Text>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{inv.billToName}</Text>
              {inv.billToAddress ? <Text>{inv.billToAddress}</Text> : null}
              {inv.billToEmail ? <Text style={st.muted}>{inv.billToEmail}</Text> : null}
              {d.clientRef ? <Text style={st.muted}>Client {d.clientRef}{d.matterRef ? ` | Matter ${d.matterRef}` : ""}</Text> : null}
            </View>
            <View style={{ width: 200 }}>
              {[
                ["ISSUE DATE", longDate(inv.issueDate)],
                ["DUE DATE", inv.dueDate ? longDate(inv.dueDate) : "Set on issue"],
                ...(inv.reference ? [["REFERENCE", inv.reference]] : []),
              ].map(([k, v]) => (
                <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                  <Text style={st.label}>{k}</Text>
                  <Text>{v}</Text>
                </View>
              ))}
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                <Text style={st.label}>AMOUNT DUE</Text>
                <Text style={{ fontFamily: "Helvetica-Bold", color: b.accent }}>{money(inv.status === "void" ? 0 : balance, inv.currency)}</Text>
              </View>
            </View>
          </View>

          <View style={st.table}>
            <View style={[st.row, { borderBottomColor: b.ink }]} fixed>
              <Text style={[st.cDesc, st.head]}>Description</Text>
              <Text style={[st.cQty, st.head]}>Qty</Text>
              <Text style={[st.cUnit, st.head]}>Unit</Text>
              <Text style={[st.cAmt, st.head]}>Amount</Text>
            </View>
            {d.lines.map((l, i) => (
              <View key={i} style={st.row} wrap={false}>
                <View style={st.cDesc}>
                  <Text>{l.description}</Text>
                  <Text style={[st.muted, { fontSize: 7.5 }]}>{KIND[l.kind] ?? l.kind}</Text>
                </View>
                <Text style={st.cQty}>{l.quantity}</Text>
                <Text style={st.cUnit}>{money(l.unitMinor, inv.currency)}</Text>
                <Text style={st.cAmt}>{money(l.totalMinor, inv.currency)}</Text>
              </View>
            ))}
          </View>

          <View style={st.totals} wrap={false}>
            <View style={st.tRow}><Text>Subtotal</Text><Text>{money(inv.subtotalMinor, inv.currency)}</Text></View>
            {inv.discountMinor ? <View style={st.tRow}><Text>Discount</Text><Text>−{money(inv.discountMinor, inv.currency)}</Text></View> : null}
            {inv.taxRateBp ? <View style={st.tRow}><Text>{p.taxLabel ?? "VAT"} at {(inv.taxRateBp / 100).toString()}%</Text><Text>{money(inv.taxMinor, inv.currency)}</Text></View> : null}
            <View style={st.tTotal}><Text style={{ fontFamily: "Helvetica-Bold" }}>Total</Text><Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{money(inv.totalMinor, inv.currency)}</Text></View>
            {inv.paidMinor ? <View style={st.tRow}><Text>Paid</Text><Text>−{money(inv.paidMinor, inv.currency)}</Text></View> : null}
            {inv.creditedMinor ? <View style={st.tRow}><Text>Credited</Text><Text>−{money(inv.creditedMinor, inv.currency)}</Text></View> : null}
            {inv.paidMinor || inv.creditedMinor ? <View style={st.tRow}><Text style={{ fontFamily: "Helvetica-Bold" }}>Balance due</Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{money(balance, inv.currency)}</Text></View> : null}
          </View>

          {inv.status === "void" && inv.voidReason ? <Text style={[st.muted, { marginTop: 14 }]}>This invoice was voided: {inv.voidReason}</Text> : null}

          {p.bankDetails && inv.status !== "void" ? (
            <View style={st.box} wrap={false}>
              <Text style={st.label}>HOW TO PAY</Text>
              <Text>{p.bankDetails}</Text>
              <Text style={[st.muted, { marginTop: 4 }]}>Use {inv.number ?? "the invoice number"} as the payment reference.</Text>
            </View>
          ) : null}

          {inv.terms ? (
            <View style={{ marginTop: 18 }} wrap={false}>
              <Text style={st.label}>TERMS</Text>
              <Text style={st.muted}>{inv.terms}</Text>
            </View>
          ) : null}
          {inv.notes ? (
            <View style={{ marginTop: 12 }}>
              <Text style={st.label}>NOTES</Text>
              <Text>{inv.notes}</Text>
            </View>
          ) : null}
        </View>

        <View style={st.footer} fixed>
          <Text style={{ maxWidth: 380 }}>{[p.footer ?? `${p.tradingName} | A partner firm of Global Immigration Hub`, p.address?.replace(/\n+/g, ", "), p.contactEmail, p.contactPhone].filter(Boolean).join(" | ")}</Text>
        </View>
        <Text style={st.pageNo} fixed render={({ pageNumber, totalPages }) => `${inv.number ?? "Draft"} | ${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(d: InvoicePdfInput): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument d={d} />);
}

export function invoiceFileName(d: InvoicePdfInput) {
  const safe = (x: string) => x.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, " ");
  return `${safe(d.invoice.billToName)} - ${d.invoice.number ?? "Draft invoice"}.pdf`;
}
