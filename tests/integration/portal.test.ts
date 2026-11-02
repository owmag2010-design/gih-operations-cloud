import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../src/server/errors";
import { convertLead, createLead } from "../../src/server/modules/crm/leads";
import { createMatter } from "../../src/server/modules/matters/matters";
import {
  addChecklistItems, closePortal, enablePortal, getPortalPanel, postStaffMessage, setChecklistStatus, updatePortalDriveFolder,
} from "../../src/server/modules/portal/portal";
import {
  endPortalSession, getPortalView, portalLinkInfo, postClientMessage, requestSignInCode, uploadClientFile, verifySignInCode,
} from "../../src/server/modules/portal/client";
import { firmId, lead, makeUser, owner, resetDatabase } from "../support/fixtures";

// Capture outgoing email so the test can read the sign-in code.
const sent: { to: string; subject: string; template: string; text: string }[] = [];
vi.mock("../../src/server/integrations/email", async (orig) => {
  const real = await orig<typeof import("../../src/server/integrations/email")>();
  return {
    ...real,
    sendEmail: vi.fn(async (e: { to: string; subject: string; template: string; text: string }) => {
      sent.push(e);
      return { status: "not_configured" as const };
    }),
  };
});

async function setup() {
  sent.length = 0;
  const veritas = await firmId("veritas");
  await owner.update(s.firms).set({ contactEmail: "cs@veritas.test" }).where(eq(s.firms.id, veritas));
  const admin = await makeUser({ name: "Vera Admin", firms: { veritas: "firm_admin" } });
  const caseManager = await makeUser({ name: "Casey Manager", firms: { veritas: "case_manager" } });
  const { lead: l } = await createLead(admin, veritas, lead({ firstName: "Thandi", lastName: "Moyo" }));
  const { client } = await convertLead(admin, veritas, l.id);
  const matter = await createMatter(admin, veritas, { clientId: client.id, title: "Section 11(6) spouse visa", caseManagerId: caseManager.user.id });
  return { veritas, admin, caseManager, matter };
}

const tokenOf = (link: string) => link.split("/portal/")[1];
const lastCode = () => sent.filter((e) => e.template === "portal_code").at(-1)!.subject.match(/(\d{6})$/)![1];

async function signIn(token: string) {
  expect(await requestSignInCode(token)).toBe("sent");
  const v = await verifySignInCode(token, lastCode());
  expect(v.result).toBe("ok");
  return v.session!;
}

describe("client portal", () => {
  beforeEach(resetDatabase);

  it("opens a portal, signs the client in with an emailed code and shows only client-visible content", async () => {
    const { veritas, admin, matter } = await setup();
    const { link, invite } = await enablePortal(admin, veritas, matter.id, { email: "thandi@client.test", sendInvite: "on" });
    expect(invite).toBe("not_configured");
    expect(sent.find((e) => e.template === "portal_invite")?.to).toBe("thandi@client.test");
    const token = tokenOf(link);

    const info = await portalLinkInfo(token);
    expect(info).toMatchObject({ firstName: "Thandi", emailHint: "th•••@client.test" });

    // Wrong codes count; five wrong tries lock the code.
    expect(await requestSignInCode(token)).toBe("sent");
    const good = lastCode();
    const bad = good === "000000" ? "111111" : "000000";
    expect((await verifySignInCode(token, bad)).result).toBe("wrong");
    expect((await verifySignInCode(token, good)).result).toBe("ok");
    // A used code can't be used again.
    expect((await verifySignInCode(token, good)).result).toBe("expired");

    const session = await signIn(token);
    await addChecklistItems(admin, veritas, matter.id, { labels: "Identity: Passport copy\nPolice clearance certificate" });
    await postStaffMessage(admin, veritas, matter.id, { body: "Welcome, Thandi. Please upload your passport." });
    await postStaffMessage(admin, veritas, matter.id, { body: "Client is anxious about timing", internal: "on" });
    expect(sent.filter((e) => e.template === "portal_message")).toHaveLength(1);

    const view = (await getPortalView(session))!;
    expect(view.matter.title).toBe("Section 11(6) spouse visa");
    expect(view.client.firstName).toBe("Thandi");
    expect(view.checklist.map((i) => [i.group, i.label, i.status])).toEqual([["Identity", "Passport copy", "needed"], [null, "Police clearance certificate", "needed"]]);
    expect(view.messages.map((m) => m.body)).toEqual(["Welcome, Thandi. Please upload your passport."]);
    expect(view.stages.length).toBeGreaterThan(3);

    await endPortalSession(session);
    expect(await getPortalView(session)).toBeNull();
  });

  it("records client messages and uploads, ticks the checklist and alerts the team", async () => {
    const { veritas, admin, caseManager, matter } = await setup();
    const { link } = await enablePortal(admin, veritas, matter.id, { email: "thandi@client.test" });
    const session = await signIn(tokenOf(link));
    const [item] = await addChecklistItems(admin, veritas, matter.id, { labels: "Passport copy" });

    sent.length = 0;
    expect(await postClientMessage(session, "  Is the police clearance from Zimbabwe fine?  ")).toBe("ok");
    const alerts = sent.filter((e) => e.template === "portal_staff_alert").map((e) => e.to).sort();
    // The matter team (case manager and the consultant who opened it) and the practice inbox.
    expect(alerts).toEqual(["cs@veritas.test", caseManager.user.email, admin.user.email].sort());

    sent.length = 0;
    const up = await uploadClientFile(session, { itemId: item.id, filename: "passport.pdf", contentType: "application/pdf", data: Buffer.from("%PDF-1.4 test") });
    expect(up).toEqual({ result: "ok", drive: "no_folder" });
    expect(sent.filter((e) => e.template === "portal_staff_alert")).toHaveLength(3);
    expect(await uploadClientFile(session, { itemId: null, filename: "virus.exe", contentType: "application/x-msdownload", data: Buffer.from("MZ") })).toEqual({ result: "wrong_type" });

    const panel = await getPortalPanel(caseManager, veritas, matter.id);
    expect(panel.messages.map((m) => [m.authorKind, m.authorName, m.body])).toEqual([["client", "Thandi Moyo", "Is the police clearance from Zimbabwe fine?"]]);
    expect(panel.checklist[0].status).toBe("uploaded");
    expect(panel.uploads.map((u) => [u.filename, u.driveStatus])).toEqual([["passport.pdf", "no_folder"]]);
    const files = await owner.select().from(s.documentFiles).where(eq(s.documentFiles.matterId, matter.id));
    expect(files.map((f) => f.filename)).toEqual(["passport.pdf"]);

    // With a folder but no Google service account, the file is kept and the panel says Drive isn't connected.
    await updatePortalDriveFolder(admin, veritas, matter.id, "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv?usp=sharing");
    const again = await uploadClientFile(session, { itemId: null, filename: "bank.pdf", contentType: "application/pdf", data: Buffer.from("%PDF-1.4 b") });
    expect(again.drive).toBe("not_configured");

    await setChecklistStatus(admin, veritas, matter.id, item.id, "accepted");
    expect((await getPortalView(session))!.checklist[0].status).toBe("accepted");
  });

  it("stops old links and sessions when the link is replaced or the portal is closed", async () => {
    const { veritas, admin, matter } = await setup();
    const first = await enablePortal(admin, veritas, matter.id, { email: "thandi@client.test" });
    const session = await signIn(tokenOf(first.link));
    const second = await enablePortal(admin, veritas, matter.id, { email: "thandi@client.test" });
    expect(await portalLinkInfo(tokenOf(first.link))).toBeNull();
    expect(await getPortalView(session)).toBeNull();
    expect(await postClientMessage(session, "hello")).toBe("signed_out");
    expect((await getPortalPanel(admin, veritas, matter.id)).access?.link).toBe(second.link);

    await closePortal(admin, veritas, matter.id);
    expect(await portalLinkInfo(tokenOf(second.link))).toBeNull();
    await expect(postStaffMessage(admin, veritas, matter.id, { body: "hi" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("limits sign-in codes and keeps portal data inside the practice", async () => {
    const { veritas, admin, matter } = await setup();
    const { link } = await enablePortal(admin, veritas, matter.id, { email: "thandi@client.test" });
    const token = tokenOf(link);
    for (let i = 0; i < 5; i++) expect(await requestSignInCode(token)).toBe("sent");
    expect(await requestSignInCode(token)).toBe("too_many");

    const mimshac = await makeUser({ firms: { mimshac: "firm_admin" } });
    await expect(getPortalPanel(mimshac, veritas, matter.id)).rejects.toBeInstanceOf(AccessDeniedError);
    const viewer = await makeUser({ firms: { veritas: "case_manager" } });
    await expect(getPortalPanel(viewer, veritas, matter.id)).rejects.toBeInstanceOf(NotFoundError);
    // The app role can't read codes or sessions directly.
    const { Pool } = await import("pg");
    const app = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await expect(app.query("select * from portal_codes")).rejects.toThrow(/permission denied/);
    await expect(app.query("select * from portal_sessions")).rejects.toThrow(/permission denied/);
    await app.end();
  });
});
