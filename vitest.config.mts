import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://gih_app:gih_app_local_dev@localhost:5432/gih_test";
const TEST_OWNER_DB = process.env.TEST_MIGRATION_DATABASE_URL ?? "postgres://gih:gih_local_dev@localhost:5432/gih_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DB,
      MIGRATION_DATABASE_URL: TEST_OWNER_DB,
      APP_URL: "http://localhost:3000",
      DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      INTAKE_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
      RESEND_API_KEY: "",
    },
  },
});
