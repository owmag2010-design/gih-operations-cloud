import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

const PASSWORD = "e2e passphrase for testing";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/f/veritas/leads");
  await expect(page).toHaveURL(/\/login$/);
});

test("security headers are set", async ({ request }) => {
  const r = await request.get("/login");
  expect(r.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(r.headers()["x-frame-options"]).toBe("DENY");
  expect(r.headers()["x-content-type-options"]).toBe("nosniff");
});

test("wrong password is refused without saying whether the account exists", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("veritas.e2e@example.test");
  await page.getByLabel("Password").fill("not the right password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
});

test("a consultant creates a lead, adds a note and converts it to a client", async ({ page }) => {
  await signIn(page, "veritas.e2e@example.test");
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/f/veritas/leads/new");
  await page.getByLabel("First name").fill("E2E");
  await page.getByLabel("Last name").fill("Person");
  await page.getByLabel("Email").fill("e2e.person@example.test");
  await page.getByLabel("Immigration category").fill("Visitor's visa");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByText(/Lead VE-L-\d{6} created/)).toBeVisible();

  await page.getByPlaceholder(/Add an internal note/).fill("Asked for passport copy.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Asked for passport copy.")).toBeVisible();

  await page.getByRole("button", { name: "Convert to client" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Convert to client" }).click();
  await expect(page).toHaveURL(/\/f\/veritas\/clients\//);
  await expect(page.getByText(/Converted to client VE-C-\d{6}/)).toBeVisible();

  await page.goto("/f/veritas/clients");
  await expect(page.getByRole("link", { name: "E2E Person" })).toBeVisible();
});

test("a member of another firm cannot open Veritas records by changing the URL", async ({ page, browser }) => {
  await signIn(page, "veritas.e2e@example.test");
  await page.goto("/f/veritas/leads?status=all");
  const href = await page.getByRole("link", { name: "E2E Person" }).getAttribute("href");
  expect(href).toMatch(/\/f\/veritas\/leads\//);
  const leadId = href!.split("/").pop();

  const other = await (await browser.newContext()).newPage();
  await signIn(other, "mimshac.e2e@example.test");
  for (const path of [`/f/veritas/leads/${leadId}`, `/f/mimshac/leads/${leadId}`, "/f/veritas", "/hq", "/f/veritas/leads/export"]) {
    const res = await other.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(other.getByText("E2E Person")).toHaveCount(0);
  }
});

test("the intake webhook needs a valid signature and is idempotent", async ({ request }) => {
  const secret = process.env.E2E__INTAKE_WEBHOOK_SECRET!;
  const send = (body: object, sig?: string) => {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    return request.post("/api/intake/webhook", {
      data: raw,
      headers: { "content-type": "application/json", "x-gih-timestamp": ts, "x-gih-signature": sig ?? createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex") },
    });
  };
  const enquiry = { firstName: "Hook", email: "hook@example.test", enquiry: "Study visa for Cape Town", source: "website_form", sourceRef: "e2e-1" };
  expect((await send(enquiry, "deadbeef")).status()).toBe(401);
  expect((await send(enquiry)).status()).toBe(201);
  expect((await send(enquiry)).status()).toBe(200);
  expect((await send({ firstName: "" })).status()).toBe(422);

  // A replayed request without a sender id is still recognised as the same delivery.
  const raw = JSON.stringify({ firstName: "Replay", email: "replay@example.test", enquiry: "Visitor visa", source: "website_form" });
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = { "content-type": "application/json", "x-gih-timestamp": ts, "x-gih-signature": createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex") };
  expect((await request.post("/api/intake/webhook", { data: raw, headers })).status()).toBe(201);
  expect((await request.post("/api/intake/webhook", { data: raw, headers })).status()).toBe(200);

  // Oversized bodies are refused before they are read.
  expect((await send({ firstName: "Big", email: "big@example.test", enquiry: "x".repeat(70_000) })).status()).toBe(413);
});

test("sign-in and leads pages have no serious accessibility violations", async ({ page }) => {
  await page.goto("/login");
  const login = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(login.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  await signIn(page, "veritas.e2e@example.test");
  for (const path of ["/f/veritas", "/f/veritas/leads", "/f/veritas/leads/new", "/f/veritas/clients"]) {
    await page.goto(path);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${path}: ${v.id}`)).toEqual([]);
  }
});

test("my day greets the person, follows their theme, and has no serious accessibility violations", async ({ page }) => {
  await signIn(page, "veritas.e2e@example.test");
  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/(Good (morning|afternoon|evening)|Welcome back), /);
  await expect(page.getByRole("heading", { name: "Your practices" })).toBeVisible();
  const axe = async () => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  expect(await axe()).toEqual([]);
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/today-light.png`, fullPage: true });

  // Switch to dark from the account menu; the choice is saved to the profile.
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("[data-deck]")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("[data-deck]")).toHaveAttribute("data-theme", "dark");
  expect(await axe()).toEqual([]);
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/today-dark.png`, fullPage: true });
  for (const path of ["/f/veritas", "/f/veritas/leads"]) {
    await page.goto(path);
    expect((await axe()).map((v) => `${path} ${v}`)).toEqual([]);
  }

  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.locator("[data-deck]")).toHaveAttribute("data-theme", "light");
});
