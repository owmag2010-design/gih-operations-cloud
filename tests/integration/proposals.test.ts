import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createLead } from "../../src/server/modules/crm/leads";
import {
  addProposalItem,
  approveProposal,
  createProposalFromLead,
  getProposal,
  getPublicProposal,
  listProposals,
  releaseProposal,
  removeProposalItem,
  renewLink,
  requestChanges,
  respondToProposal,
  reviseProposal,
  submitForReview,
  updateProposal,
  updateProposalItem,
} from "../../src/server/modules/proposals/proposals";
import { getServiceWithHistory, listCatalogue, parseMoney, updateService } from "../../src/server/modules/services/services";
import { withScope } from "../../src/server/db/client";
import * as s from "../../src/server/db/schema";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../src/server/errors";
import { auditCount, firmId, lead, makeUser, owner, resetDatabase } from "../support/fixtures";

const tokenOf = (url: string) => url.split("/p/")[1];

async function setup() {
  const veritas = await firmId("veritas");
  const admin = await makeUser({ firms: { veritas: "firm_admin" } });
  const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
  const { lead: l } = await createLead(consultant, veritas, lead({ immigrationCategory: "Spouse visa", destinationCountry: "ZA" }));
  const catalogue = await listCatalogue(admin, veritas, { activeOnly: true });
  return { veritas, admin, consultant, lead: l, catalogue };
}

describe("money parsing", () => {
  it("reads the ways people type amounts", () => {
    expect(parseMoney("12500")).toBe(1_250_000);
    expect(parseMoney("R 12,500.50")).toBe(1_250_050);
    expect(parseMoney("12 500")).toBe(1_250_000);
    expect(parseMoney("-5")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
  });
});

describe("services and fees", () => {
  beforeEach(resetDatabase);

  it("keeps every price as a version and audits the change", async () => {
    const { veritas, admin, catalogue } = await setup();
    const svc = catalogue[0];
    expect(svc.version).toBe(1);
    const { version } = await updateService(admin, veritas, svc.id, {
      name: svc.name, category: svc.category, jurisdiction: "ZA", currency: "ZAR",
      lines: [{ label: "Professional fee", amount: "16000", kind: "professional" }, { label: "VFS application fee", amount: "2550", kind: "government" }],
      deposit: "9275", isActive: true, reason: "2027 fee review",
    });
    expect(version).toBe(2);
    const { service, history } = await getServiceWithHistory(admin, veritas, svc.id);
    expect(service.totalMinor).toBe(1_855_000);
    expect(history.map((h) => h.version)).toEqual([2, 1]);
    expect(history[1].totalMinor).toBe(svc.totalMinor);
    expect(await auditCount("service.updated")).toBe(1);
  });

  it("refuses fee changes without the permission, and deposits above the total", async () => {
    const { veritas, admin, consultant, catalogue } = await setup();
    const input = { name: "X service", category: "Other", lines: [{ label: "Fee", amount: "100" }], deposit: "50", reason: "test" };
    await expect(updateService(consultant, veritas, catalogue[0].id, input)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(updateService(admin, veritas, catalogue[0].id, { ...input, deposit: "500" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not let the app rewrite price history", async () => {
    const { veritas, admin } = await setup();
    await expect(
      withScope({ orgId: admin.orgId, userId: admin.user.id, firmIds: [veritas] }, (tx) => tx.execute(sql`update service_price_versions set total_minor = 1 where firm_id = ${veritas}`)),
    ).rejects.toThrow();
  });
});

describe("proposals", () => {
  beforeEach(resetDatabase);

  it("runs a lead through draft, review, approval, release and client acceptance", async () => {
    const { veritas, admin, consultant, lead: l, catalogue } = await setup();
    const svc = catalogue.find((c) => c.depositMinor > 0)!;
    const p = await createProposalFromLead(consultant, veritas, l.id, { serviceIds: [svc.id] });
    expect(p.ref).toMatch(/^VE-P-\d{6}$/);
    expect(p.totalMinor).toBe(svc.totalMinor);
    expect(p.sections.find((x) => x.key === "enquiry")?.body).toContain("Spouse visa for my husband");

    await addProposalItem(consultant, veritas, p.id, { label: "Courier", quantity: "2", unit: "350", deposit: "" });
    let view = await getProposal(consultant, veritas, p.id);
    expect(view.proposal.totalMinor).toBe(svc.totalMinor + 70_000);
    expect(view.items[0].servicePriceVersion).toBe(1);

    await updateProposal(consultant, veritas, p.id, { title: "Spouse visa proposal", recipientName: "Thandi Test", recipientEmail: "", validDays: "10", currency: "ZAR", sections: view.proposal.sections });

    // Consultants can't approve or send; reviewers can't edit.
    await submitForReview(consultant, veritas, p.id);
    await expect(approveProposal(consultant, veritas, p.id)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(updateProposal(consultant, veritas, p.id, { title: "x y z", recipientName: "AB", sections: [] })).rejects.toBeInstanceOf(ConflictError);

    await requestChanges(admin, veritas, p.id, "Add the notarial fee");
    view = await getProposal(consultant, veritas, p.id);
    expect(view.proposal.status).toBe("changes_requested");
    expect(view.proposal.reviewNote).toBe("Add the notarial fee");
    await addProposalItem(consultant, veritas, p.id, { label: "Notarial contract", unit: "3000", deposit: "3000" });
    await submitForReview(consultant, veritas, p.id);
    await approveProposal(admin, veritas, p.id);
    await expect(releaseProposal(consultant, veritas, p.id)).rejects.toBeInstanceOf(AccessDeniedError);
    const { url, validUntil } = await releaseProposal(admin, veritas, p.id);
    expect(new Date(validUntil).getTime() - Date.now()).toBeGreaterThan(9 * 86_400_000);

    // Editing after release is refused; the snapshot is frozen.
    await expect(addProposalItem(consultant, veritas, p.id, { label: "Late", unit: "1" })).rejects.toBeInstanceOf(ConflictError);

    const token = tokenOf(url);
    const pub = await getPublicProposal(token);
    expect(pub?.status).toBe("released");
    expect(pub?.snapshot.items).toHaveLength(3);
    expect(pub?.snapshot.firm.tradingName).toBe("Veritas Emigrate");
    expect(await respondToProposal(token, { accept: true, name: "", ip: "203.0.113.5" })).toBe("name_required");
    expect(await respondToProposal(token, { accept: true, name: "Thandi Test", ip: "203.0.113.5" })).toBe("accepted");
    expect(await respondToProposal(token, { accept: false, name: "Thandi Test", ip: "203.0.113.5" })).toBe("already_accepted");

    view = await getProposal(admin, veritas, p.id);
    expect(view.proposal.status).toBe("accepted");
    expect(view.proposal.responseName).toBe("Thandi Test");
    expect(view.proposal.firstViewedAt).not.toBeNull();
    expect(await auditCount("proposal.accepted")).toBe(1);
    const acts = await owner.select().from(s.activities).where(eq(s.activities.leadId, l.id));
    expect(acts.filter((a) => a.type === "proposal").map((a) => a.data.event)).toEqual(expect.arrayContaining(["created", "submitted", "approved", "released", "viewed", "accepted"]));
  });

  it("refuses unknown, expired and withdrawn links", async () => {
    const { veritas, admin, lead: l, catalogue } = await setup();
    const p = await createProposalFromLead(admin, veritas, l.id, { serviceIds: [catalogue[0].id] });
    await submitForReview(admin, veritas, p.id);
    await approveProposal(admin, veritas, p.id);
    const { url } = await releaseProposal(admin, veritas, p.id);
    expect(await getPublicProposal("x".repeat(43))).toBeNull();
    expect(await getPublicProposal("../../etc")).toBeNull();

    await owner.update(s.proposals).set({ linkExpiresAt: new Date(Date.now() - 1000) }).where(eq(s.proposals.id, p.id));
    expect((await getPublicProposal(tokenOf(url)))?.expired).toBe(true);
    expect(await respondToProposal(tokenOf(url), { accept: true, name: "Thandi", ip: null })).toBe("expired");

    const renewed = await renewLink(admin, veritas, p.id, 7);
    expect(await getPublicProposal(tokenOf(url))).toBeNull(); // old link dead
    expect((await getPublicProposal(tokenOf(renewed.url)))?.expired).toBe(false);
  });

  it("starts a new version after a decline and keeps the old snapshot", async () => {
    const { veritas, admin, lead: l, catalogue } = await setup();
    const p = await createProposalFromLead(admin, veritas, l.id, { serviceIds: [catalogue[0].id] });
    await submitForReview(admin, veritas, p.id);
    await approveProposal(admin, veritas, p.id);
    const { url } = await releaseProposal(admin, veritas, p.id);
    expect(await respondToProposal(tokenOf(url), { accept: false, name: "Thandi Test", note: "Too expensive", ip: null })).toBe("declined");
    await reviseProposal(admin, veritas, p.id);
    const view = await getProposal(admin, veritas, p.id);
    expect(view.proposal.version).toBe(2);
    expect(view.proposal.status).toBe("draft");
    expect(view.versions.map((v) => v.version)).toEqual([1]);
    const item = view.items[0];
    await updateProposalItem(admin, veritas, p.id, item.id, { label: item.label, quantity: "1", unit: "9000", deposit: "4500" });
    expect((await getProposal(admin, veritas, p.id)).proposal.totalMinor).toBe(900_000);
    await removeProposalItem(admin, veritas, p.id, item.id);
    await expect(submitForReview(admin, veritas, p.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps proposals inside their firm", async () => {
    const { veritas, admin, lead: l, catalogue } = await setup();
    const mimshac = await firmId("mimshac");
    const other = await makeUser({ firms: { mimshac: "firm_admin" } });
    const p = await createProposalFromLead(admin, veritas, l.id, { serviceIds: [catalogue[0].id] });
    await expect(getProposal(other, veritas, p.id)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(getProposal(other, mimshac, p.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listProposals(other, mimshac)).rows).toHaveLength(0);
    // A Mimshac service can't be priced into a Veritas proposal.
    const mimshacSvc = (await listCatalogue(other, mimshac))[0];
    await expect(addProposalItem(admin, veritas, p.id, { serviceId: mimshacSvc.id })).rejects.toBeInstanceOf(NotFoundError);
    // Even with the app role and the wrong firm in scope, the database hides the rows.
    const seen = await withScope({ orgId: admin.orgId, userId: null, firmIds: [mimshac] }, (tx) => tx.execute(sql`select id from proposals where id = ${p.id}`));
    expect(seen.rows).toHaveLength(0);
    const items = await withScope({ orgId: admin.orgId, userId: null, firmIds: [mimshac] }, (tx) => tx.execute(sql`select id from proposal_items`));
    expect(items.rows).toHaveLength(0);
  });
});
