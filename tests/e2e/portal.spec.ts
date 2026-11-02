import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

const PASSWORD = "e2e passphrase for testing";
const SHOTS = process.env.E2E_SCREENSHOTS;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

/**
 * Email isn't connected in e2e, so the test replaces the latest emailed code
 * with a known one (stored the same way: hashed and bound to the link).
 */
async function knownCode(token: string, code: string) {
  const pool = new Pool({ connectionString: process.env.E2E__MIGRATION_DATABASE_URL, max: 1 });
  await pool.query(
    `update portal_codes set code_hash = $1 where id = (select c.id from portal_codes c join portal_access a on a.id = c.access_id where a.token_hash = $2 order by c.created_at desc limit 1)`,
    [sha(`${sha(token)}:${code}`), sha(token)],
  );
  await pool.end();
}

test("staff open a client portal; the client signs in, uploads and messages; staff see it and reply", async ({ page, browser }) => {
  await signIn(page, "veritas.e2e@example.test");
  await page.goto("/f/veritas/clients/new");
  await page.getByLabel("First name").fill("Thandi");
  await page.getByLabel("Last name").fill("Portal");
  await page.getByLabel("Email").fill(`thandi.${Date.now()}@example.test`);
  await page.getByRole("button", { name: /Create client|Save client|Add client/ }).click();
  await page.getByRole("link", { name: "Open a matter" }).click();
  await page.getByLabel("Matter title").fill("Section 11(6) spouse visa");
  await page.getByRole("button", { name: "Open matter" }).click();
  await expect(page).toHaveURL(/\/f\/veritas\/matters\/[0-9a-f-]{36}/);

  const portal = page.locator("#portal");
  await portal.getByRole("button", { name: "Add documents" }).click();
  await page.getByRole("dialog").getByLabel("Documents").fill("Identity: Passport copy\nClearances: Police clearance certificate");
  await page.getByRole("dialog").getByRole("button", { name: "Add" }).click();
  await expect(portal.getByText("Police clearance certificate")).toBeVisible();

  await portal.getByRole("button", { name: "Open client portal" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open portal" }).click();
  await expect(page.getByText(/Portal open\./)).toBeVisible();
  const link = await portal.getByLabel("Portal link").inputValue();
  const token = link.split("/portal/")[1];
  expect(token).toMatch(/^[A-Za-z0-9_-]{40,64}$/);
  expect(await serious(page)).toEqual([]);

  // The client, in a separate browser with no staff session.
  const client = await (await browser.newContext()).newPage();
  await client.goto(`/portal/${token}`);
  await expect(client.getByRole("heading", { name: "Welcome, Thandi." })).toBeVisible();
  expect(await serious(client)).toEqual([]);
  if (SHOTS) await client.screenshot({ path: `${SHOTS}/portal-sign-in.png`, fullPage: true });
  await client.getByRole("button", { name: "Email me a code" }).click();
  await expect(client.getByLabel("Six-digit code")).toBeVisible();
  await knownCode(token, "246810");
  await client.getByLabel("Six-digit code").fill("246810");
  await client.getByRole("button", { name: "Open my portal" }).click();

  await expect(client.getByRole("heading", { name: /Welcome back, Thandi/ })).toBeVisible();
  await expect(client.getByText("Upload 2 documents for your application")).toBeVisible();
  expect(await serious(client)).toEqual([]);
  if (SHOTS) await client.screenshot({ path: `${SHOTS}/portal-overview.png`, fullPage: true });

  await client.getByRole("tab", { name: /Documents/ }).click();
  await client.getByLabel("Upload Passport copy").setInputFiles({ name: "passport.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% e2e\n") });
  await expect(client.getByText("Uploaded. Your team has been told")).toBeVisible();
  await expect(client.getByText("Received, being checked")).toBeVisible();
  if (SHOTS) await client.screenshot({ path: `${SHOTS}/portal-documents.png`, fullPage: true });

  await client.getByRole("tab", { name: /Journey/ }).click();
  await expect(client.getByText("Happening now")).toBeVisible();
  expect(await serious(client)).toEqual([]);

  await client.getByRole("tab", { name: /Messages/ }).click();
  await client.getByLabel("Write a message").fill("Is a Zimbabwean police clearance fine?");
  await client.getByRole("button", { name: "Send message" }).click();
  await expect(client.getByText("Message sent.")).toBeVisible();
  await expect(client.getByText("Is a Zimbabwean police clearance fine?")).toBeVisible();

  // Staff see the upload, the ticked item and the message; they reply and add an internal note.
  await page.reload();
  await expect(portal.getByText("passport.pdf")).toBeVisible();
  await expect(portal.getByText("Client waiting for a reply")).toBeVisible();
  await portal.getByLabel("Reply to the client").fill("Yes, a Zimbabwean clearance is fine. Please upload it when you have it.");
  await portal.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Sent to the portal|Sent\. The client/)).toBeVisible();
  await portal.getByLabel("Reply to the client").fill("Check SAPS receipt next week");
  await portal.getByLabel("Internal note (the client never sees it)").check();
  await portal.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Internal note saved.")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/portal-staff-panel.png`, fullPage: true });

  await client.reload();
  await client.getByRole("tab", { name: /Messages/ }).click();
  await expect(client.getByText("Yes, a Zimbabwean clearance is fine.")).toBeVisible();
  await expect(client.getByText("Check SAPS receipt next week")).toHaveCount(0);
  if (SHOTS) await client.screenshot({ path: `${SHOTS}/portal-messages.png`, fullPage: true });

  // Sign out ends the session.
  await client.getByRole("button", { name: "Sign out" }).click();
  await expect(client.getByRole("button", { name: "Email me a code" })).toBeVisible();
});
