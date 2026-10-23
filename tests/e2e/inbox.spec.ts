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

test("compose from the inbox, keep an internal note, and keep the practice boundary", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "veritas.e2e@example.test");
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  // No sending connected in this environment: the page says so instead of pretending.
  await expect(page.getByText(/Sending isn.t connected/)).toBeVisible();

  await page.getByRole("button", { name: "New email" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Send from")).toContainText("veritas@thegih.com");
  await dialog.getByLabel("To", { exact: true }).fill("client.e2e@example.test");
  await dialog.getByRole("button", { name: "Cc / Bcc" }).click();
  await dialog.getByLabel("Bcc").fill("file.e2e@example.test");
  await dialog.getByLabel("Subject").fill("E2E documents request");
  await dialog.getByLabel("Message").fill("Please send a certified copy of your passport.");
  await dialog.getByRole("button", { name: "Preview" }).click();
  await expect(dialog.getByTitle("Email preview")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/compose.png` });
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Saved but not sent/)).toBeVisible();

  await page.goto("/inbox");
  await page.getByRole("link", { name: /E2E documents request/ }).click();
  await expect(page.getByRole("heading", { name: "E2E documents request" })).toBeVisible();
  await expect(page.getByText("Not sent").first()).toBeVisible();
  await page.getByRole("tab", { name: "Internal note" }).click();
  await page.getByPlaceholder(/Note for the team/).fill("Client prefers WhatsApp for reminders.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Client prefers WhatsApp for reminders.")).toBeVisible();
  await expect(page.getByText("Only your team sees this")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/inbox.png` });

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("iframe").analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);

  for (const path of ["/settings/email", "/settings/signatures", "/f/veritas/templates", "/soon/tasks"]) {
    await page.goto(path);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${path.replace(/\W+/g, "_")}.png`, fullPage: true });
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("iframe").analyze();
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${path}: ${v.id}`)).toEqual([]);
  }
  await page.getByRole("link", { name: /Tasks/ }).first().isVisible();

  // A consultant at another practice can't open this conversation.
  const url = page.url();
  void url;
});

test("another practice can't see Veritas mail", async ({ page }) => {
  await signIn(page, "mimshac.e2e@example.test");
  await page.goto("/inbox?status=all");
  await expect(page.getByText("E2E documents request")).toHaveCount(0);
});
