import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generate } from "otplib";

const PASSWORD = "e2e passphrase for testing";
const SHOTS = process.env.E2E_SCREENSHOTS;
const state = () => JSON.parse(readFileSync("tests/e2e/.state.json", "utf8")) as { totpSecret: string };

const STEP_FILE = "tests/e2e/.totp-step";

async function signInHub(page: Page) {
  // Each 30-second code is accepted once (also across worker restarts), so wait for a fresh window if this one was used.
  const last = existsSync(STEP_FILE) ? Number(readFileSync(STEP_FILE, "utf8")) : 0;
  while (Math.floor(Date.now() / 30_000) <= last) await page.waitForTimeout(1000);
  writeFileSync(STEP_FILE, String(Math.floor(Date.now() / 30_000)));
  await page.goto("/login");
  await page.getByLabel("Email").fill("hub.e2e@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Code").fill(await generate({ secret: state().totpSecret }));
  await page.getByRole("button", { name: /Verify|Continue|Sign in/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

test("a Hub reviewer takes New Zealand from draft to operational", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInHub(page);
  await page.goto("/hq/settings");
  await page.getByRole("link", { name: /Countries/ }).click();
  await expect(page.getByRole("heading", { name: "Countries" })).toBeVisible();
  for (const name of ["Australia", "New Zealand", "South Africa"]) await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Australia/ }).getByRole("cell").nth(4)).toHaveText("0 of 2 verified"); // NSW and ACT drafts
  expect(await serious(page)).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/countries-list.png`, fullPage: true });

  await page.getByRole("link", { name: "New Zealand", exact: true }).click();
  await expect(page).toHaveURL(/\/hq\/countries\/NZ$/);
  await expect(page.getByText("Not operational: nothing client-facing can use this country yet.")).toBeVisible();
  await expect(page.getByLabel("Currency")).toHaveValue("NZD");
  expect(await serious(page)).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/country-nz-draft.png`, fullPage: true });

  // Review: send, verify (self-review is allowed but shown), then go live once a calendar and source are verified.
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByText("Sent for review.")).toBeVisible();
  await page.getByRole("button", { name: "Verify profile" }).click();
  await expect(page.getByText("Reviewed by the person who submitted it")).toBeVisible();
  await expect(page.getByRole("button", { name: "Make operational" })).toBeDisabled();
  await page.getByRole("button", { name: "Verify dates" }).click();
  await expect(page.getByText(/Calendar verified/)).toBeVisible();
  await page.getByRole("button", { name: "Verify", exact: true }).first().click();
  await expect(page.getByText("Source verified.")).toBeVisible();
  await page.getByRole("button", { name: "Make operational" }).click();
  await expect(page.getByText("NZ is now operational.")).toBeVisible();
  await expect(page.getByText("Operational: services and proposals for this country can go to clients.")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/country-nz-operational.png`, fullPage: true });

  // Editing sends it back to draft, and says so first.
  await expect(page.getByText(/Saving takes NZ out of operational use/)).toBeVisible();
  await page.getByLabel("What changed and why").fill("Added a note on regional anniversary days");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByText(/back in draft until it's reviewed again/)).toBeVisible();
});

test("the practice-by-country matrix records checks per practice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInHub(page);
  await page.goto("/hq/countries/AU");
  await page.getByText("Record a check").click();
  const form = page.locator("form", { has: page.getByRole("button", { name: "Save check" }) });
  await form.getByLabel("Practice").selectOption({ label: "Veritas Emigrate" });
  await form.getByLabel("Area").selectOption({ label: "Payments" });
  await form.getByLabel("Provider or law").fill("Stripe");
  await form.getByLabel("Status").selectOption({ label: "Pending" });
  await form.getByLabel("Note or test result").fill("Waiting for an Australian test account");
  await form.getByRole("button", { name: "Save check" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Payments/ }).getByText("Stripe")).toBeVisible();
  expect(await serious(page)).toEqual([]);
});

test("a consultant sees the destination's status when opening a matter", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("veritas.e2e@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/f/veritas/clients/new");
  await page.getByLabel("First name").fill("Country");
  await page.getByLabel("Last name").fill("Client");
  await page.getByLabel("Email").fill(`country.${Date.now()}@example.test`);
  await page.getByLabel("Nationality").selectOption("ZW");
  await page.getByLabel("Other nationalities").fill("GB");
  await page.getByLabel("Country of residence").selectOption("ZA");
  await page.getByRole("button", { name: /Create client|Save client|Add client/ }).click();
  await page.getByRole("link", { name: "Open a matter" }).click();
  await page.getByLabel("Matter title").fill("Skilled visa: Australia");
  await page.getByLabel("Destination country").selectOption("AU");
  await expect(page.getByText(/The country profile for AU is draft/)).toBeVisible();
  await page.getByLabel("Handled from").selectOption({ label: "Pretoria Centre (ZA)" });
  expect(await serious(page)).toEqual([]);
  await page.getByRole("button", { name: "Open matter" }).click();
  await expect(page).toHaveURL(/\/f\/veritas\/matters\/[0-9a-f-]{36}/);
  await expect(page.getByText("profile draft")).toBeVisible();
  await expect(page.getByText("Pretoria Centre (South Africa)")).toBeVisible();
  await expect(page.getByText("Zimbabwe, United Kingdom")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/matter-four-countries.png`, fullPage: true });
});
