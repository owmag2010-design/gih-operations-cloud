import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Tx } from "../../db/client";
import { emailSignatures, firms } from "../../db/schema";
import { env } from "../../env";
import { AccessDeniedError, ValidationError } from "../../errors";
import { parseOrThrow } from "../../validation";
import { brandFor, renderSignature, type SignatureData } from "./render";

/**
 * Signatures: one practice default per practice (and one for the Hub), and one
 * per staff member per practice. When sending, the sender's own signature for
 * that practice wins; otherwise the practice default; otherwise their name.
 */

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const url = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((v) => v || null)
  .refine((v) => v === null || /^https:\/\/[^\s]+$/.test(v) || /^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v), "Enter a web address starting with https://");

const signatureSchema = z.object({
  fullName: optional(120),
  role: optional(160),
  phone: optional(60),
  email: z.string().trim().max(200).optional().transform((v) => v || null).refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email address."),
  website: url,
  bookingUrl: url,
  disclaimer: optional(1200),
  showLogo: z.union([z.boolean(), z.literal("on"), z.literal("")]).optional().transform((v) => v === true || v === "on"),
});

export type SignatureInput = z.input<typeof signatureSchema>;

function requireManagePractice(ctx: AccessContext, firmId: string | null) {
  if (firmId ? ctx.has("firm:manage", firmId) || ctx.has("mailboxes:manage") : ctx.has("mailboxes:manage")) return;
  throw new AccessDeniedError("mailboxes:manage");
}
function requireOwnPractice(ctx: AccessContext, firmId: string | null) {
  if (firmId ? ctx.firms.has(firmId) : ctx.has("intake:view") || ctx.has("hub_email:send")) return;
  throw new AccessDeniedError("firm");
}

const orgScope = (ctx: AccessContext) => ({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [] as string[] });

export async function getSignatures(ctx: AccessContext, firmId: string | null) {
  requireOwnPractice(ctx, firmId);
  return withScope(orgScope(ctx), async (tx) => {
    const scope = firmId ? eq(emailSignatures.firmId, firmId) : isNull(emailSignatures.firmId);
    const rows = await tx.select().from(emailSignatures).where(and(eq(emailSignatures.orgId, ctx.orgId), scope));
    return { practice: rows.find((r) => r.userId === null) ?? null, mine: rows.find((r) => r.userId === ctx.user.id) ?? null };
  });
}

export async function saveSignature(ctx: AccessContext, firmId: string | null, which: "practice" | "mine", raw: unknown) {
  if (which === "practice") requireManagePractice(ctx, firmId);
  else requireOwnPractice(ctx, firmId);
  const input = parseOrThrow(signatureSchema, raw);
  if (which === "mine" && !input.fullName) throw new ValidationError("Enter your name as it should appear.", { fullName: "Enter your name." });
  const userId = which === "mine" ? ctx.user.id : null;
  return withScope(orgScope(ctx), async (tx) => {
    const scope = and(eq(emailSignatures.orgId, ctx.orgId), firmId ? eq(emailSignatures.firmId, firmId) : isNull(emailSignatures.firmId), userId ? eq(emailSignatures.userId, userId) : isNull(emailSignatures.userId));
    const [existing] = await tx.select({ id: emailSignatures.id }).from(emailSignatures).where(scope);
    const values = { ...input, updatedById: ctx.user.id, updatedAt: new Date() };
    const [row] = existing
      ? await tx.update(emailSignatures).set(values).where(eq(emailSignatures.id, existing.id)).returning()
      : await tx.insert(emailSignatures).values({ ...values, orgId: ctx.orgId, firmId, userId }).returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "email_signature.saved", entityType: "email_signature", entityId: row.id, summary: which === "practice" ? "Updated the practice signature" : "Updated their own signature", ip: ctx.ip }, tx);
    return row;
  });
}

type FirmBrand = { slug: string; tradingName: string; brandColor: string } | null;

async function firmBrand(tx: Tx, firmId: string | null): Promise<FirmBrand> {
  if (!firmId) return null;
  const [f] = await tx.select({ slug: firms.slug, tradingName: firms.tradingName, brandColor: firms.brandColor }).from(firms).where(eq(firms.id, firmId));
  return f ?? null;
}

/** The signature for this sender in this practice, rendered once. */
export async function resolveSignatureTx(tx: Tx, orgId: string, firmId: string | null, sender: { id: string; name: string }) {
  const rows = await tx
    .select()
    .from(emailSignatures)
    .where(and(eq(emailSignatures.orgId, orgId), firmId ? eq(emailSignatures.firmId, firmId) : isNull(emailSignatures.firmId), eq(emailSignatures.isActive, true)));
  const mine = rows.find((r) => r.userId === sender.id);
  const practice = rows.find((r) => r.userId === null);
  const f = await firmBrand(tx, firmId);
  const brand = brandFor(f, env().APP_URL);
  const practiceName = f?.tradingName ?? "Global Immigration Hub";
  const pick = <K extends keyof NonNullable<typeof mine>>(k: K) => (mine?.[k] ?? practice?.[k] ?? null) as NonNullable<typeof mine>[K] | null;
  const data: SignatureData = {
    fullName: mine?.fullName ?? sender.name,
    role: mine?.role ?? null,
    practice: practiceName,
    phone: pick("phone"),
    email: pick("email"),
    website: pick("website"),
    bookingUrl: pick("bookingUrl"),
    disclaimer: practice?.disclaimer ?? mine?.disclaimer ?? null,
    showLogo: mine ? mine.showLogo : (practice?.showLogo ?? true),
  };
  return { ...renderSignature(data, brand), data };
}

/** Preview for the settings screen. */
export async function previewSignature(ctx: AccessContext, firmId: string | null, raw: unknown) {
  requireOwnPractice(ctx, firmId);
  const input = parseOrThrow(signatureSchema, raw);
  return withScope(orgScope(ctx), async (tx) => {
    const f = await firmBrand(tx, firmId);
    const brand = brandFor(f, env().APP_URL);
    return renderSignature({ ...input, fullName: input.fullName ?? ctx.user.name, practice: f?.tradingName ?? "Global Immigration Hub" }, brand);
  });
}
