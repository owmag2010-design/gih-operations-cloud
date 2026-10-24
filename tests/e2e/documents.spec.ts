import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "e2e passphrase for testing";

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
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

test("draft a letter from a template, review it, make it final, and upload a scan with OCR", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, "veritas.e2e@example.test");
  await page.goto("/f/veritas/clients/new");
  await page.getByLabel("First name").fill("Docu");
  await page.getByLabel("Last name").fill("Ment");
  await page.getByLabel("Email").fill(`docu.${Date.now()}@example.test`);
  await page.getByRole("button", { name: /Create client|Save client|Add client/ }).click();
  await page.getByRole("link", { name: "Open a matter" }).click();
  await page.getByLabel("Matter title").fill("Critical skills visa: E2E");
  await page.getByRole("button", { name: "Open matter" }).click();
  await expect(page).toHaveURL(/\/f\/veritas\/matters\/[0-9a-f-]{36}/);
  const matterUrl = page.url().split("?")[0];

  // Upload a scan: original kept, text read by OCR.
  await page.locator("#documents input[type=file]").setInputFiles("tests/fixtures/ocr-sample.png");
  await expect(page.locator("#documents").getByText("Text read")).toBeVisible({ timeout: 30_000 });
  await page.locator("#documents").getByRole("button", { name: "Read text" }).click();
  await expect(page.getByRole("dialog")).toContainText("Passport number TEST 12345");
  await expect(page.getByRole("dialog")).toContainText("Machine-generated");
  await page.keyboard.press("Escape");

  // New document from the matter, using the starter letter.
  await page.locator("#documents").getByRole("link", { name: "New document" }).click();
  await page.getByLabel("Template").selectOption({ label: "Client letter (starter)" });
  await page.getByLabel("Title", { exact: true }).fill("Next steps for your visa");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/f\/veritas\/documents\/[0-9a-f-]{36}/);
  const editor = page.getByRole("textbox", { name: "Document text" });
  await expect(editor).toContainText("Dear Docu,");
  await expect(page.getByText("Still to complete")).toBeVisible();
  expect(await serious(page)).toEqual([]);

  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Dear Docu,\nWe have lodged your application and will update you within five working days.");
  await expect(page.getByRole("status").filter({ hasText: /Saved \d/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Nothing outstanding.")).toBeVisible();

  await page.getByRole("button", { name: "Send for review" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByText(/Waiting for a reviewer|for review/).first()).toBeVisible();
  const docUrl = page.url().split("?")[0];

  await signIn(page, "reviewer.e2e@example.test");
  await page.goto(docUrl);
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/Approved by Rita Reviewer/)).toBeVisible();

  await signIn(page, "veritas.e2e@example.test");
  await page.goto(docUrl);
  await page.getByRole("button", { name: "Make final" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Make final" }).click();
  await expect(page.getByText(/Final version 2/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a new version from this" })).toBeVisible();

  const pdf = await page.request.get(`${docUrl}/export?format=pdf`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const docx = await page.request.get(`${docUrl}/export?format=docx`);
  expect(docx.status()).toBe(200);
  expect((await docx.body()).subarray(0, 2).toString()).toBe("PK");
  expect(await serious(page)).toEqual([]);

  await page.goto(matterUrl);
  await expect(page.locator("#documents").getByText("Next steps for your visa")).toBeVisible();

  await signIn(page, "veritas.e2e@example.test");
  for (const path of ["/f/veritas/documents", "/f/veritas/documents/new"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await serious(page), path).toEqual([]);
  }
});
