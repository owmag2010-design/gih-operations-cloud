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

test("reads engine conversations for the person's own practice only", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "veritas.e2e@example.test");
  await page.goto("/conversations?tests=1");
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible();
  await expect(page.getByText(/Replying here is on for test contacts|Read-only: to reply|Replies sent here go out/)).toBeVisible();
  const list = page.getByRole("complementary", { name: "Conversation list" });
  await expect(list.getByText("E2E Thandi Test")).toBeVisible();
  await expect(list.getByText("E2E Joyce Test")).toHaveCount(0);
  await list.getByText("E2E Thandi Test").click();
  const thread = page.getByRole("list", { name: "Messages" });
  await expect(thread.getByText("I need a spouse visa")).toBeVisible();
  await expect(thread.getByText("May I have your full name?")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in engine dashboard" })).toHaveAttribute("href", /proposals\.thegih\.com\/ops\/#lead=/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/conversations-veritas.png` });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  // Tests are hidden by default.
  await page.goto("/conversations");
  await expect(page.getByRole("complementary", { name: "Conversation list" }).getByText("E2E Thandi Test")).toHaveCount(0);
});

test("another practice sees its own conversation and its proposal", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "mimshac.e2e@example.test");
  await page.goto("/conversations?tests=1");
  const list = page.getByRole("complementary", { name: "Conversation list" });
  await expect(list.getByText("E2E Joyce Test")).toBeVisible();
  await expect(list.getByText("E2E Thandi Test")).toHaveCount(0);
  await list.getByText("E2E Joyce Test").click();
  await expect(page.getByRole("complementary", { name: "Client" }).getByText("GIH-E2E-1", { exact: false })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/conversations-mimshac.png` });
});
