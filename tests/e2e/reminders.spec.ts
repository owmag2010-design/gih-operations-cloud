import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { signInWithCode } from "./mfa";

const SHOTS = process.env.E2E_SCREENSHOTS;

async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

// Leave reminders off for the other specs.
test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.E2E__MIGRATION_DATABASE_URL });
  await pool.query(`delete from reminder_settings where firm_id = (select id from firms where slug = 'veritas')`);
  await pool.end();
});

test("a practice administrator switches reminders on and the limits are checked", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInWithCode(page, "veritas.admin.e2e@example.test");
  await page.goto("/f/veritas/settings#reminders");
  const panel = page.locator("#reminders");
  await expect(panel.getByText("Client reminders:")).toBeVisible();
  await expect(panel.getByText("Off", { exact: true }).first()).toBeVisible();

  await panel.getByLabel(/Remind clients about documents they still owe/).check();
  await panel.getByLabel("Remind a client at most every").fill("2");
  await panel.getByRole("button", { name: "Save reminders" }).click();
  // The browser stops values under the minimum; nothing is saved.
  await expect(panel.getByText("Off", { exact: true }).first()).toBeVisible();

  await panel.getByLabel("Remind a client at most every").fill("5");
  await panel.getByLabel(/Email each team member a daily digest/).check();
  await panel.getByRole("button", { name: "Save reminders" }).click();
  await expect(page.getByText("Reminders saved.")).toBeVisible();
  await expect(panel.getByText("On, at most every 5 days")).toBeVisible();

  expect(await serious(page)).toEqual([]);
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/reminders-settings.png` });
});
