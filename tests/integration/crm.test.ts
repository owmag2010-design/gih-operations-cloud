import { beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../../src/server/errors";
import { listClients } from "../../src/server/modules/clients/clients";
import { addLeadNote, changeStage, convertLead, createLead, exportLeadsCsv, getLead, listLeads, listStages, updateLead } from "../../src/server/modules/crm/leads";
import { auditCount, firmId, lead, makeUser, resetDatabase } from "../support/fixtures";

describe("CRM", () => {
  beforeEach(resetDatabase);

  it("creates leads with firm references, normalised phones and consent", async () => {
    const mimshac = await firmId("mimshac");
    const c = await makeUser({ firms: { mimshac: "immigration_consultant" } });
    const { lead: a } = await createLead(c, mimshac, lead({ phone: "082 123 4567", consentContact: "on" }));
    const { lead: b } = await createLead(c, mimshac, lead());
    expect(a.ref).toBe("MG-L-000001");
    expect(b.ref).toBe("MG-L-000002");
    expect(a.phone).toBe("+27821234567");
    const detail = await getLead(c, mimshac, a.id);
    expect(detail.consents).toHaveLength(1);
    expect(detail.timeline.map((t) => t.type)).toEqual(expect.arrayContaining(["created", "consent"]));
    expect(await auditCount("lead.created")).toBe(2);
  });

  it("requires an email or a phone and validates countries", async () => {
    const veritas = await firmId("veritas");
    const c = await makeUser({ firms: { veritas: "immigration_consultant" } });
    await expect(createLead(c, veritas, { firstName: "No Contact" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createLead(c, veritas, lead({ currentCountry: "XQ" }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("flags possible duplicates within the firm", async () => {
    const veritas = await firmId("veritas");
    const c = await makeUser({ firms: { veritas: "immigration_consultant" } });
    await createLead(c, veritas, lead({ email: "same@test.example" }));
    const second = await createLead(c, veritas, lead({ email: "SAME@test.example" }));
    expect(second.duplicates).toHaveLength(1);
  });

  it("moves stages, but only conversion reaches a won stage", async () => {
    const veritas = await firmId("veritas");
    const c = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const { lead: l } = await createLead(c, veritas, lead());
    const stages = await listStages(c, veritas);
    const assessment = stages.find((s) => s.key === "assessment")!;
    const won = stages.find((s) => s.category === "won")!;
    await changeStage(c, veritas, [l.id], assessment.id);
    expect((await getLead(c, veritas, l.id)).stage.key).toBe("assessment");
    await expect(changeStage(c, veritas, [l.id], won.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("converts a lead exactly once, even when asked twice at the same time", async () => {
    const veritas = await firmId("veritas");
    const c = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const { lead: l } = await createLead(c, veritas, lead({ consentContact: "on" }));
    const [x, y] = await Promise.all([convertLead(c, veritas, l.id), convertLead(c, veritas, l.id)]);
    expect(x.client.id).toBe(y.client.id);
    expect([x.created, y.created].filter(Boolean)).toHaveLength(1);
    expect(x.client.ref).toBe("VE-C-000001");
    const clients = await listClients(c, veritas);
    expect(clients.total).toBe(1);
    const detail = await getLead(c, veritas, l.id);
    expect(detail.stage.category).toBe("won");
    expect(detail.client?.id).toBe(x.client.id);
  });

  it("records updates and notes on the timeline", async () => {
    const veritas = await firmId("veritas");
    const c = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const { lead: l } = await createLead(c, veritas, lead());
    await updateLead(c, veritas, l.id, lead({ email: l.email, firstName: "Thandiwe", priority: "high" }));
    await addLeadNote(c, veritas, l.id, "Called; wants a consultation next week.");
    const d = await getLead(c, veritas, l.id);
    expect(d.lead.firstName).toBe("Thandiwe");
    expect(d.timeline.find((t) => t.type === "note")?.body).toContain("consultation");
    expect((d.timeline.find((t) => t.type === "updated")?.data as { fields: string[] }).fields).toEqual(expect.arrayContaining(["firstName", "priority"]));
  });

  it("filters, searches and exports safely", async () => {
    const veritas = await firmId("veritas");
    const admin = await makeUser({ firms: { veritas: "firm_admin" } });
    await createLead(admin, veritas, lead({ firstName: "=HYPERLINK(\"x\")", lastName: "Formula" }));
    await createLead(admin, veritas, lead({ firstName: "Peter", priority: "urgent", tags: "vip, spouse" }));
    expect((await listLeads(admin, veritas, { q: "peter" })).total).toBe(1);
    expect((await listLeads(admin, veritas, { priority: "urgent" })).total).toBe(1);
    expect((await listLeads(admin, veritas, { tag: "vip" })).total).toBe(1);
    expect((await listLeads(admin, veritas, { q: "%" })).total).toBe(0);
    const csv = await exportLeadsCsv(admin, veritas, {});
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(await auditCount("lead.exported")).toBe(1);
  });
});
