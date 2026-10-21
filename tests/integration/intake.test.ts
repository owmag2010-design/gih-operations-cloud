import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, ConflictError } from "../../src/server/errors";
import { getLead } from "../../src/server/modules/crm/leads";
import { captureIntake, listIntake, receiveIntake, routeIntakeItem, saveRule } from "../../src/server/modules/intake/intake";
import { firmId, makeUser, resetDatabase } from "../support/fixtures";

const enquiry = (over: Record<string, unknown> = {}) => ({ firstName: "Tendai", lastName: "Moyo", email: `t${Math.random().toString(36).slice(2, 7)}@test.example`, source: "website_form", ...over });

describe("Hub intake and routing", () => {
  beforeEach(resetDatabase);

  it("suggests the firm from the default rules", async () => {
    const ops = await makeUser({ group: "group_ops_admin" });
    const cases: [Record<string, unknown>, string | null, string][] = [
      [{ enquiry: "I overstayed and was declared undesirable" }, await firmId("mimshac"), "new"],
      [{ enquiry: "Work visa for my job in Joburg", currentCountry: "ZW" }, await firmId("mimshac"), "new"],
      [{ enquiry: "Investor looking at a business visa" }, await firmId("nextmove"), "new"],
      [{ enquiry: "Spouse visa for my wife" }, await firmId("veritas"), "new"],
      [{ enquiry: "I want to apply for asylum" }, null, "held"],
      [{ enquiry: "Skilled visa", destinationCountry: "AU" }, null, "held"],
      [{ enquiry: "" }, null, "held"],
    ];
    for (const [over, firm, status] of cases) {
      const { item } = await captureIntake(ops, enquiry(over));
      expect([item.suggestedFirmId, item.status], JSON.stringify(over)).toEqual([firm, status]);
    }
  });

  it("is idempotent for repeated webhook deliveries", async () => {
    const ops = await makeUser({ group: "group_ops_admin" });
    const a = await receiveIntake(ops.orgId, enquiry({ sourceRef: "tally-123", enquiry: "Study visa" }));
    const b = await receiveIntake(ops.orgId, enquiry({ sourceRef: "tally-123", enquiry: "Study visa" }));
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.item.id).toBe(a.item.id);
    const { rows } = await listIntake(ops);
    expect(rows).toHaveLength(1);
  });

  it("routes into a firm without giving the router access to the firm's records", async () => {
    const veritas = await firmId("veritas");
    const ops = await makeUser({ group: "group_ops_admin" });
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const { item } = await captureIntake(ops, enquiry({ enquiry: "Visitor visa", consentContact: true }));
    const result = await routeIntakeItem(ops, item.id, veritas);
    expect(result.leadRef).toBe("VE-L-000001");
    await expect(routeIntakeItem(ops, item.id, veritas)).rejects.toBeInstanceOf(ConflictError);

    const { rows } = await listIntake(ops, "routed");
    const leadId = rows[0].routedLeadId!;
    await expect(getLead(ops, veritas, leadId)).rejects.toBeInstanceOf(AccessDeniedError);
    const detail = await getLead(consultant, veritas, leadId);
    expect(detail.lead.source).toBe("hub_intake");
    expect(detail.consents).toHaveLength(1);
  });

  it("only routing managers edit rules; new rules sit before the catch-all", async () => {
    const ops = await makeUser({ group: "group_ops_admin" });
    const superAdmin = await makeUser({ group: "group_super_admin" });
    await expect(saveRule(ops, null, { name: "Test", action: "hold", keywords: "x" })).rejects.toBeInstanceOf(AccessDeniedError);
    await saveRule(superAdmin, null, { name: "Medical treatment held for review", action: "hold", keywords: "medical treatment", isActive: "on" });
    const { item } = await captureIntake(ops, enquiry({ enquiry: "Medical treatment visa for my mother" }));
    expect(item.status).toBe("held");
    expect(item.suggestionReason).toBe("Medical treatment held for review");
  });

  it("closes the intake queue to people without intake permissions", async () => {
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    await expect(listIntake(consultant)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(captureIntake(consultant, enquiry({ enquiry: "x" }))).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
