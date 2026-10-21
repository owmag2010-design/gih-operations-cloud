import "server-only";
import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  if (!stored) {
    // Spend comparable time so a missing account is not distinguishable by timing.
    await hash(password, OPTIONS);
    return false;
  }
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

const COMMON = new Set([
  "password1234", "passwordpassword", "123456789012", "qwertyuiopas", "welcome12345",
  "immigration1", "globalimmigration", "letmein12345", "changeme1234", "administrator",
]);

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "Use 200 characters or fewer.";
  if (COMMON.has(password.toLowerCase())) return "That password is too common.";
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4)
    return "Don't include your email name in the password.";
  if (/^(.)\1+$/.test(password)) return "That password is too simple.";
  return null;
}
