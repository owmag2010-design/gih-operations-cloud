import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the production build against a separate database
 * (gih_e2e). Run with: npm run test:e2e (builds first).
 */
const PORT = 3100;
export const E2E_ENV = {
  NODE_ENV: "production",
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://gih_app:gih_app_local_dev@localhost:5432/gih_e2e",
  MIGRATION_DATABASE_URL: process.env.E2E_MIGRATION_DATABASE_URL ?? "postgres://gih:gih_local_dev@localhost:5432/gih_e2e",
  APP_URL: `http://localhost:${PORT}`,
  DATA_ENCRYPTION_KEY: process.env.E2E_DATA_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
  INTAKE_WEBHOOK_SECRET: process.env.E2E_INTAKE_WEBHOOK_SECRET ?? randomBytes(32).toString("hex"),
  RESEND_API_KEY: "",
};
for (const [k, v] of Object.entries(E2E_ENV)) process.env[`E2E__${k}`] ??= v;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: Object.fromEntries(Object.keys(E2E_ENV).map((k) => [k, process.env[`E2E__${k}`]!])),
  },
});
