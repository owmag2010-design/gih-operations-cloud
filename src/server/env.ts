import "server-only";
import { z } from "zod";

/** Decode a 32-byte key given as base64 (44 chars) or hex (64 chars); null if it is neither. */
export function decodeKey(value: string): Buffer | null {
  const v = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, "hex");
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(v)) {
    const buf = Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return buf.length === 32 ? buf : null;
  }
  return null;
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATA_ENCRYPTION_KEY: z
    .string()
    .transform((v) => v.trim())
    .superRefine((v, ctx) => {
      if (!decodeKey(v)) {
        ctx.addIssue({
          code: "custom",
          message: `DATA_ENCRYPTION_KEY must be 32 random bytes: the output of "openssl rand -base64 32" (44 characters) or "openssl rand -hex 32" (64 characters). The value set has ${v.length} characters.`,
        });
      }
    }),
  INTAKE_WEBHOOK_SECRET: z.string().trim().min(32, "INTAKE_WEBHOOK_SECRET must be at least 32 characters"),
  RESEND_API_KEY: z.string().optional().default(""),
  /** Signing secret of the Resend webhook (whsec_…) for received mail and delivery events. */
  RESEND_WEBHOOK_SECRET: z.string().optional().default(""),
  EMAIL_FROM: z.string().default("Global Immigration Hub <hello@thegih.com>"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated environment. Throws a readable error on the first call if anything is missing. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
