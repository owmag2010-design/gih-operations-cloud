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

test("draft an invoice, issue it, and record a payment that waits for a second person", async ({ page }) => {
  await signIn(page, "veritas.e2e@example.test");
  await page.goto("/f/veritas/clients/new");
  await page.getByLabel("First name").fill("Invoice");
  await page.getByLabel("Last name").fill("Client");
  await page.getByLabel("Email").fill(`invoice.${Date.now()}@example.test`);
  await page.getByRole("button", { name: /Create client|Save client|Add client/ }).click();
  await expect(page).toHaveURL(/\/f\/veritas\/clients\/[0-9a-f-]{36}/);
  const clientId = page.url().split("/").pop()!.split("?")[0];

  await page.goto(`/f/veritas/finance/invoices/new?client=${clientId}`);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/f\/veritas\/finance\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Draft invoice" })).toBeVisible();
  await page.getByLabel("Description").fill("Spousal visa application: professional fee");
  await page.getByLabel("Unit amount").fill("12500");
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByLabel("Type").nth(1).selectOption("government");
  await page.getByLabel("Description").nth(1).fill("VFS service fee");
  await page.getByLabel("Unit amount").nth(1).fill("1550");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await expect(page.getByText(/R\s?14\s?050/).first()).toBeVisible();
  expect(await serious(page)).toEqual([]);
  const invoiceUrl = page.url();

  await signIn(page, "finance.e2e@example.test");
  await page.goto(invoiceUrl);
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByRole("heading", { name: /VE-INV-\d{6}/ })).toBeVisible();
  await expect(page.locator("main span", { hasText: /^Issued$/ }).first()).toBeVisible();

  await page.getByRole("button", { name: "Record payment" }).click();
  await page.getByRole("dialog").getByLabel("Bank or receipt reference").fill("FNB statement 0425");
  await page.getByRole("dialog").getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Awaiting verification").first()).toBeVisible();
  await expect(page.getByText("Another person verifies").first()).toBeVisible();
  expect(await serious(page)).toEqual([]);

  const pdf = await page.request.get(`${invoiceUrl}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  for (const path of ["/f/veritas/finance", "/f/veritas/finance/invoices", "/f/veritas/finance/payments", "/f/veritas/finance/settings", "/finance"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await serious(page), path).toEqual([]);
  }
});
