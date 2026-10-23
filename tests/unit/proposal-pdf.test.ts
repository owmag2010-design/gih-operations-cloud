import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pdfFileName, renderProposalPdf } from "../../src/server/modules/proposals/pdf";
import { defaultSections } from "../../src/server/modules/proposals/templates";
import type { ProposalSnapshot } from "../../src/server/db/schema";

function sample(slug: string): ProposalSnapshot {
  const firm = slug === "veritas"
    ? { tradingName: "Veritas Emigrate", legalName: "Veritas Emigrate (Pty) Ltd", brandColor: "#9e1f63", slug, contactEmail: "owen@veritasemigrate.com", contactPhone: null, website: "https://veritasemigrate.com" }
    : { tradingName: "Mimshac Group", legalName: "Mimshac Group", brandColor: "#e6a930", slug, contactEmail: "owen@mimshacgroup.com", contactPhone: null, website: null };
  return {
    ref: `${slug === "veritas" ? "VE" : "MG"}-P-000001`, title: "Section 11(6) spouse visa proposal", version: 1, firm,
    recipientName: "Sample Client", recipientEmail: null, currency: "ZAR", totalMinor: 2_255_000, depositMinor: 1_127_500,
    sections: defaultSections({ firmSlug: slug, firmName: firm.tradingName, firstName: "Sample", enquiry: "I want to join my husband in South Africa on a spouse visa.", category: "Spouse visa", destination: "South Africa", serviceNames: ["Section 11(6) spouse visa"], depositPercent: 50 }),
    items: [{ label: "Section 11(6) spouse visa", description: null, quantity: 1, unitMinor: 2_255_000, depositMinor: 1_127_500, lines: [
      { label: "Professional fee", amountMinor: 1_500_000, kind: "professional" }, { label: "Notarial contract", amountMinor: 300_000, kind: "third_party" },
      { label: "VFS application fee", amountMinor: 255_000, kind: "government" }, { label: "Police clearance", amountMinor: 200_000, kind: "third_party" }] }],
    preparedBy: "Owen Magocha", releasedAt: "2026-10-21T10:00:00.000Z", validUntil: "2026-11-04T10:00:00.000Z",
  };
}

describe("proposal PDF", () => {
  it.each(["veritas", "mimshac", "nextmove"])("renders the %s design", async (slug) => {
    const pdf = await renderProposalPdf(sample(slug), true);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(4000);
    if (process.env.PDF_SAMPLE_DIR) writeFileSync(`${process.env.PDF_SAMPLE_DIR}/sample-${slug}.pdf`, pdf);
  });
  it("names the file after the client and reference", () => {
    expect(pdfFileName(sample("veritas"))).toBe("Sample Client - VE-P-000001 v1.pdf");
  });
});
