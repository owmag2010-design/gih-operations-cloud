import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "e2e passphrase for testing";
const SHOTS = process.env.E2E_SCREENSHOTS;

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

test("open a matter, record a fact, add a task and a note, and see it on the calendar", async ({ page }) => {
  await signIn(page, "veritas.e2e@example.test");
  // A client to work with
  await page.goto("/f/veritas/clients/new");
  await page.getByLabel("First name").fill("Matter");
  await page.getByLabel("Last name").fill("Client");
  await page.getByLabel("Email").fill(`matter.${Date.now()}@example.test`);
  await page.getByRole("button", { name: /Create client|Save client|Add client/ }).click();
  await expect(page).toHaveURL(/\/f\/veritas\/clients\/[0-9a-f-]{36}/);

  await page.getByRole("link", { name: "Open a matter" }).click();
  await page.getByLabel("Matter title").fill("Spouse visa: E2E");
  await page.getByRole("button", { name: "Open matter" }).click();
  await expect(page).toHaveURL(/\/f\/veritas\/matters\/[0-9a-f-]{36}\?opened=1/);
  await expect(page.getByText(/Matter VE-M-\d{6} opened/)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Matter stage" })).toContainText("Matter opening");

  // Fact with its basis
  await page.getByRole("button", { name: "Record a fact" }).click();
  await page.getByRole("dialog").getByLabel("About").fill("Date of marriage");
  await page.getByRole("dialog").getByLabel("Fact").fill("12 March 2019");
  await page.getByRole("dialog").getByRole("button", { name: "Record fact" }).click();
  await expect(page.getByText("12 March 2019")).toBeVisible();
  await expect(page.getByText("Client statement").first()).toBeVisible();

  // Task on the matter
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Task").fill("Request marriage certificate");
  await page.getByRole("dialog").getByRole("button", { name: "Add task" }).click();
  await expect(page.locator("#tasks").getByText("Request marriage certificate")).toBeVisible();

  // Internal note
  await page.getByPlaceholder("Add a note").fill("Client prefers WhatsApp.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Client prefers WhatsApp.")).toBeVisible();

  // Move stage
  await page.getByRole("button", { name: /Document collection/ }).click();
  await expect(page.getByText("Moved to Document collection.")).toBeVisible();

  expect(await serious(page)).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/matter.png`, fullPage: true });

  for (const path of ["/tasks", "/calendar", "/matters", "/f/veritas/matters", "/f/veritas/settings/matters", "/airtable"]) {
    await page.goto(path);
    expect((await serious(page)).map((v) => `${path} ${v}`)).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${path.replace(/\//g, "_")}.png`, fullPage: true });
  }
  await page.goto("/tasks");
  await expect(page.getByText("Request marriage certificate")).toBeVisible();
});

test("another practice can't open Veritas matters", async ({ page }) => {
  await signIn(page, "mimshac.e2e@example.test");
  const res = await page.goto("/f/veritas/matters");
  expect(res?.status()).toBe(404);
});
