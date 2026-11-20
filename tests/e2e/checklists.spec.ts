import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { signInWithCode } from "./mfa";

const SHOTS = process.env.E2E_SCREENSHOTS;

async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

// Put Australia back to draft for the other specs, whatever happens here.
test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.E2E__MIGRATION_DATABASE_URL });
  await pool.query(`update country_profiles set status = 'draft' where code = 'AU'`);
  await pool.end();
});

test("a practice publishes an Australian checklist and a matter works through its documents", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // What a Hub reviewer would have done: Australia verified.
  const pool = new Pool({ connectionString: process.env.E2E__MIGRATION_DATABASE_URL });
  await pool.query(`update country_profiles set status = 'verified' where code = 'AU'`);
  await pool.end();

  await signInWithCode(page, "veritas.admin.e2e@example.test");
  await page.goto("/f/veritas/settings/matters#checklists");
  await page.getByLabel("Checklist name").fill("Partner visa: documents");
  await page.getByLabel("Destination country").selectOption("AU");
  await page.getByRole("button", { name: "Start checklist" }).click();
  await expect(page).toHaveURL(/\/settings\/checklists\/[0-9a-f-]{36}/);
  await expect(page.getByText(/Before publishing: add at least one document/)).toBeVisible();

  await page.getByLabel("Document", { exact: true }).fill("Passport");
  await page.getByLabel("Who it's for").selectOption("each_applicant");
  await page.getByLabel("Has an expiry date to record").check();
  await page.getByRole("button", { name: "Add document" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Each applicant" })).toBeVisible();
  await page.getByLabel("Document", { exact: true }).fill("Relationship evidence");
  await page.getByLabel("Who it's for").selectOption("matter");
  await page.getByRole("button", { name: "Add document" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Relationship evidence" })).toContainText("Once for the matter");
  await page.getByLabel("Or describe the source").fill("Department document checklist, checked 21 Nov 2026");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Checklist saved.")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Publish version" }).click();
  await expect(page.getByText(/Published\. New matters get this version/)).toBeVisible();
  expect(await serious(page)).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/checklist-published.png`, fullPage: true });

  // A client and an Australian matter
  await page.goto("/f/veritas/clients/new");
  await page.getByLabel("First name").fill("Docs");
  await page.getByLabel("Last name").fill("Client");
  await page.getByLabel("Email").fill(`docs.${Date.now()}@example.test`);
  await page.getByRole("button", { name: /Create client|Save client|Add client/ }).click();
  await page.getByRole("link", { name: "Open a matter" }).click();
  await page.getByLabel("Matter title").fill("Partner visa: Australia");
  await page.getByLabel("Destination country").selectOption("AU");
  await page.getByRole("button", { name: "Open matter" }).click();
  await expect(page).toHaveURL(/\/f\/veritas\/matters\/[0-9a-f-]{36}/);

  const panel = page.locator("#requests");
  await panel.getByRole("button", { name: "Request documents" }).click();
  await expect(page.getByText("2 documents requested.")).toBeVisible();
  await expect(panel.getByText("2 required still outstanding")).toBeVisible();

  // Upload a scan to the matter, then mark the passport received and accept it with its expiry.
  await page.locator("#documents input[type=file]").setInputFiles({ name: "passport-scan.txt", mimeType: "text/plain", buffer: Buffer.from("passport scan") });
  await expect(page.locator("#documents").getByText("passport-scan.txt")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  const passport = panel.getByRole("listitem").filter({ hasText: "Passport" });
  await passport.getByRole("button", { name: "Mark received" }).click();
  await passport.getByRole("button", { name: "Mark received" }).last().click();
  await expect(passport.getByText("Received", { exact: true })).toBeVisible();
  await passport.getByRole("button", { name: "Accept", exact: true }).click();
  await passport.getByLabel("Expiry date on the document").fill("2031-05-01");
  await passport.getByRole("button", { name: "Accept document" }).click();
  await expect(passport.getByText("Accepted", { exact: true })).toBeVisible();
  await expect(passport.getByText("Expires 2031-05-01")).toBeVisible();

  const rel = panel.getByRole("listitem").filter({ hasText: "Relationship evidence" });
  await rel.getByRole("button", { name: "Waive" }).click();
  await rel.getByLabel("Why it isn't needed").fill("Already provided with the earlier application");
  await rel.getByRole("button", { name: "Waive", exact: true }).last().click();
  await expect(rel.getByText("Waived", { exact: true })).toBeVisible();
  await expect(panel.getByText("0 required still outstanding")).toBeVisible();
  expect(await serious(page)).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/matter-documents.png`, fullPage: true });
});
