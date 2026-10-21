import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { z } from "zod";
import { isCountryCode } from "@/lib/countries";
import { ValidationError } from "./errors";

/** Parse with a Zod schema or throw a ValidationError carrying per-field messages. */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  throw new ValidationError("Check the highlighted fields.", fieldErrors);
}

/** Empty strings from forms become undefined. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const optionalCountry = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || isCountryCode(v), "Choose a country from the list.");

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || z.string().email().safeParse(v).success, "Enter a valid email address.");

export const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || z.string().uuid().safeParse(v).success, "Invalid selection.");

/** Normalise a phone number to E.164 when possible; keep the trimmed input otherwise. */
export function normalisePhone(raw: string | undefined, defaultCountry?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const region = (defaultCountry && /^[A-Z]{2}$/.test(defaultCountry) ? defaultCountry : "ZA") as CountryCode;
  const parsed = parsePhoneNumberFromString(trimmed, region);
  return parsed?.isValid() ? parsed.number : trimmed.replace(/[^\d+]/g, "").slice(0, 20) || undefined;
}

export const tagsField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    const list = Array.isArray(v) ? v : (v ?? "").split(",");
    return [...new Set(list.map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))].slice(0, 12).map((t) => t.slice(0, 32));
  });

/** <input type="datetime-local"> or ISO string → Date. */
export const optionalDate = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date." });
      return z.NEVER;
    }
    return d;
  });
