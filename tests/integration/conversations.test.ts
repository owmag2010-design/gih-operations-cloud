import { Pool } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { getConversation, listConversations, queueCounts } from "../../src/server/modules/conversations/conversations";
import { makeUser, resetDatabase } from "../support/fixtures";

/**
 * Conversations are read from the enquiry engine's tables through the
 * ops_engine views. These tests check that each person sees only the
 * practices they belong to, and that the app role cannot reach the engine
 * tables directly.
 */
const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
const app = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

type Ids = { veritas: string; mimshac: string; hub: string; override: string; test: string };

async function seedEngine(): Promise<Ids> {
  await owner.query("truncate engine.messages, engine.proposals, engine.chats, engine.leads");
  const lead = async (name: string, facts: object, extra: { instructions?: object; proposal?: string; isTest?: boolean; channel?: string } = {}) => {
    const { rows } = await owner.query(
      `insert into engine.leads (name, email, first_channel, status, facts, instructions, proposal_slug, is_test, last_message_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now()) returning id`,
      [name, `${name.toLowerCase().replace(/\s+/g, ".")}@test.example`, extra.channel ?? "whatsapp", extra.proposal ? "proposal_sent" : "waiting_details", facts, extra.instructions ?? {}, extra.proposal ?? null, extra.isTest ?? false],
    );
    return rows[0].id as string;
  };
  const veritas = await lead("Thandi Veritas", { site_source: "veritas-site" });
  const mimshac = await lead("Joyce Mimshac", {}, { proposal: "overstay-abc123" });
  const hub = await lead("Peter Hub", {}, { channel: "email" });
  const override = await lead("Ruth Override", { site_source: "veritas-site" }, { instructions: { firm: "Nextmove Advisory", pause: true } });
  const test = await lead("Owen Test", { site_source: "veritas-site" }, { isTest: true });
  await owner.query(`insert into engine.proposals (slug, lead_id, status, record) values ('overstay-abc123', $1, 'sent', $2)`, [
    mimshac,
    { ref: "GIH-JM-LEG-1234", matter: "Overstay appeal", firm: { name: "Mimshac Group" }, currency: "ZAR", deposit_pct: 50, fees: [{ amount: 10000 }, { amount: 500 }] },
  ]);
  await owner.query(`insert into engine.proposals (slug, lead_id, status, record) values ('tpl-overstay', null, 'ready', '{}')`);
  await owner.query(
    `insert into engine.messages (lead_id, channel, direction, body, delivery, payload, created_at) values
       ($1, 'whatsapp', 'in', 'I need a spouse visa', null, '{}', now() - interval '3 hours'),
       ($1, 'whatsapp', 'out', 'May I have your full name?', 'whatsapp:abc', null, now() - interval '2 hours'),
       ($1, 'whatsapp', 'out', 'Hi Thandi, this is the team', 'whatsapp:def', '{"by":"owen"}', now() - interval '1 hour'),
       ($1, 'whatsapp', 'in', 'Thank you', null, '{}', now() - interval '30 minutes'),
       ($2, 'whatsapp', 'in', 'Overstay ban help', null, '{}', now()),
       ($3, 'email', 'in', 'Question about a UK visa', null, '{}', now())`,
    [veritas, mimshac, hub],
  );
  return { veritas, mimshac, hub, override, test };
}

describe("Conversations from the enquiry engine", () => {
  let ids: Ids;
  beforeEach(async () => {
    await resetDatabase();
    ids = await seedEngine();
  });

  it("shows a practice only its own conversations, matched by website, proposal or instruction", async () => {
    const veritasStaff = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const names = (await listConversations(veritasStaff)).map((c) => c.name);
    expect(names).toEqual(["Thandi Veritas"]);
    const mimshacStaff = await makeUser({ firms: { mimshac: "case_manager" } });
    expect((await listConversations(mimshacStaff)).map((c) => c.name)).toEqual(["Joyce Mimshac"]);
    const nextmoveStaff = await makeUser({ firms: { nextmove: "immigration_consultant" } });
    const nm = await listConversations(nextmoveStaff);
    expect(nm.map((c) => c.name)).toEqual(["Ruth Override"]);
    expect(nm[0].paused).toBe(true);
  });

  it("shows unmatched Hub conversations only to Hub intake, never practice records without membership", async () => {
    const ops = await makeUser({ group: "group_ops_admin" });
    expect((await listConversations(ops)).map((c) => c.name)).toEqual(["Peter Hub"]);
    expect(await getConversation(ops, ids.veritas)).toBeNull();
  });

  it("refuses a conversation from another practice", async () => {
    const veritasStaff = await makeUser({ firms: { veritas: "immigration_consultant" } });
    expect(await getConversation(veritasStaff, ids.mimshac)).toBeNull();
    expect(await getConversation(veritasStaff, ids.hub)).toBeNull();
  });

  it("returns the thread in order with who wrote each message, and the proposal", async () => {
    const all = await makeUser({ group: "group_ops_admin", firms: { veritas: "firm_admin", mimshac: "firm_admin" } });
    const v = await getConversation(all, ids.veritas);
    expect(v?.messages.map((m) => [m.direction, m.author])).toEqual([["in", "client"], ["out", "engine"], ["out", "team"], ["in", "client"]]);
    expect(v?.whatsappOpenUntil).not.toBeNull();
    const m = await getConversation(all, ids.mimshac);
    expect(m?.proposals).toHaveLength(1);
    expect(m?.proposals[0]).toMatchObject({ ref: "GIH-JM-LEG-1234", core: 10500, depositPct: 50, firm: "Mimshac Group" });
  });

  it("filters queues and leaves tests out unless asked", async () => {
    const all = await makeUser({ group: "group_ops_admin", firms: { veritas: "firm_admin", mimshac: "firm_admin", nextmove: "firm_admin" } });
    expect((await listConversations(all)).map((c) => c.name).sort()).toEqual(["Joyce Mimshac", "Peter Hub", "Ruth Override", "Thandi Veritas"]);
    expect((await listConversations(all, { tests: true })).length).toBe(5);
    expect((await listConversations(all, { queue: "needs_reply" })).map((c) => c.name).sort()).toEqual(["Joyce Mimshac", "Peter Hub", "Thandi Veritas"]);
    expect((await listConversations(all, { queue: "handling" })).map((c) => c.name)).toEqual(["Ruth Override"]);
    expect((await listConversations(all, { q: "uk visa" })).length).toBe(0);
    expect((await listConversations(all, { q: "GIH-JM" })).map((c) => c.name)).toEqual(["Joyce Mimshac"]);
    const counts = await queueCounts(all);
    expect(counts).toMatchObject({ all: 4, proposal: 1, hub: 1, email: 1, whatsapp: 3 });
  });

  it("keeps the app role away from the engine tables and the views outside a scope", async () => {
    await expect(app.query("select * from engine.leads")).rejects.toThrow(/permission denied/);
    const { rows } = await app.query("select count(*)::int n from ops_engine.leads");
    expect(rows[0].n).toBe(0);
  });
});
