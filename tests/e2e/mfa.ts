import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { generate } from "otplib";

const PASSWORD = "e2e passphrase for testing";
const STEP_FILE = "tests/e2e/.totp-step";

/** Sign in a user enrolled in two-step sign-in by global-setup. Each 30-second code is accepted once, so wait for a fresh window when needed. */
export async function signInWithCode(page: Page, email: string) {
  const { totpSecret } = JSON.parse(readFileSync("tests/e2e/.state.json", "utf8")) as { totpSecret: string };
  const last = existsSync(STEP_FILE) ? Number(readFileSync(STEP_FILE, "utf8")) : 0;
  while (Math.floor(Date.now() / 30_000) <= last) await page.waitForTimeout(1000);
  writeFileSync(STEP_FILE, String(Math.floor(Date.now() / 30_000)));
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Code").fill(await generate({ secret: totpSecret }));
  await page.getByRole("button", { name: /Verify|Continue|Sign in/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
