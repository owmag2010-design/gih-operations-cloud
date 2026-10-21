/**
 * Configuration seed (idempotent). Runs as the schema owner.
 *
 * Seeds ONLY configuration: the organisation, default roles, the three partner
 * firms, shared GIH centres, pipeline stages, routing rules and the approved
 * fee schedule. It creates no clients, leads or transactions.
 *
 * Used by `npm run db:seed` (scripts/seed.ts) and the test setup.
 */
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ROLES } from "../src/server/access/permissions";
import * as s from "../src/server/db/schema";
import { DEFAULT_PIPELINE } from "../src/server/modules/crm/pipeline-defaults";
import { parseFeeSchedule } from "../src/server/modules/services/fee-schedule";

const FIRMS = [
  {
    slug: "veritas",
    legalName: "Veritas Emigrate (Pty) Ltd",
    tradingName: "Veritas Emigrate",
    refPrefix: "VE",
    brandColor: "#1f3a5f",
    jurisdictions: ["ZA", "ZW", "AU", "NZ"],
    contactEmail: null,
    emailDomain: null,
    website: null,
    feeSchedule: true,
  },
  {
    slug: "mimshac",
    legalName: "Mimshac Group",
    tradingName: "Mimshac Group",
    refPrefix: "MG",
    brandColor: "#e6a930",
    jurisdictions: ["ZA", "ZW"],
    contactEmail: "owen@mimshacgroup.com",
    emailDomain: "mimshacgroup.com",
    website: null,
    feeSchedule: true, // Mimshac uses the same fees as Veritas
  },
  {
    slug: "nextmove",
    legalName: "Nextmove Advisory",
    tradingName: "Nextmove Advisory",
    refPrefix: "NM",
    brandColor: "#2f6b5a",
    jurisdictions: ["ZA"],
    contactEmail: "advisory@nextmoveza.com",
    emailDomain: "nextmoveza.com",
    website: null,
    feeSchedule: false, // fees not yet confirmed; configure in firm settings
  },
] as const;

const OFFICES = [
  { key: "pretoria", name: "Pretoria Centre", addressLine1: "115 Paul Kruger Street", addressLine2: "New Court Chambers", city: "Pretoria", country: "ZA", timezone: "Africa/Johannesburg", firms: ["veritas", "mimshac"] },
  { key: "harare", name: "Harare Centre", addressLine1: "Office 2, 12th Floor", addressLine2: "Joina City", city: "Harare", country: "ZW", timezone: "Africa/Harare", firms: ["veritas", "mimshac"] },
];

const LEGAL_KEYWORDS = [
  "ban", "banned", "overstay", "overstayed", "v-list", "vlist", "undesirable", "prohibited", "appeal", "refused",
  "refusal", "rejected", "rejection", "refugee", "detained", "detention", "deport", "deportation", "litigation", "court",
];
const CORPORATE_KEYWORDS = ["investment", "investor", "business visa", "corporate", "intra-company", "company transfer", "dti", "capital"];

export async function runSeed(db: NodePgDatabase<typeof s>, log: (m: string) => void = console.log) {
  await db.transaction(async (tx) => {
    // Organisation
    let [org] = await tx.select().from(s.organisations).where(eq(s.organisations.slug, "gih")).limit(1);
    if (!org) [org] = await tx.insert(s.organisations).values({ name: "Global Immigration Hub", slug: "gih", hqCountry: "AU" }).returning();

    // Roles (system roles: insert or refresh permissions)
    for (const r of DEFAULT_ROLES) {
      await tx
        .insert(s.roles)
        .values({ orgId: org.id, key: r.key, name: r.name, description: r.description, scope: r.scope, permissions: r.permissions, isSystem: true })
        .onConflictDoUpdate({ target: [s.roles.orgId, s.roles.key], set: { name: r.name, description: r.description, permissions: r.permissions, updatedAt: sql`now()` } });
    }

    // Firms
    const firmIds: Record<string, string> = {};
    for (const f of FIRMS) {
      let [firm] = await tx.select().from(s.firms).where(eq(s.firms.slug, f.slug)).limit(1);
      if (!firm) {
        [firm] = await tx
          .insert(s.firms)
          .values({
            orgId: org.id, slug: f.slug, legalName: f.legalName, tradingName: f.tradingName, refPrefix: f.refPrefix,
            brandColor: f.brandColor, jurisdictions: [...f.jurisdictions], contactEmail: f.contactEmail, emailDomain: f.emailDomain, website: f.website,
          })
          .returning();
        log(`  + firm ${f.tradingName}`);
      }
      firmIds[f.slug] = firm.id;

      // Pipeline stages
      for (const [i, st] of DEFAULT_PIPELINE.entries()) {
        await tx.insert(s.pipelineStages).values({ firmId: firm.id, key: st.key, name: st.name, category: st.category, position: i }).onConflictDoNothing();
      }
    }

    // Offices (GIH centres shared by firms)
    for (const o of OFFICES) {
      let [office] = await tx.select().from(s.offices).where(and(eq(s.offices.orgId, org.id), eq(s.offices.name, o.name))).limit(1);
      if (!office) {
        [office] = await tx
          .insert(s.offices)
          .values({ orgId: org.id, name: o.name, kind: "gih_centre", addressLine1: o.addressLine1, addressLine2: o.addressLine2, city: o.city, country: o.country, timezone: o.timezone })
          .returning();
      }
      for (const slug of o.firms) await tx.insert(s.firmOffices).values({ firmId: firmIds[slug], officeId: office.id }).onConflictDoNothing();
    }

    // Routing rules (only when none exist, so edits made in the app are kept)
    const existingRules = await tx.select({ id: s.routingRules.id }).from(s.routingRules).where(eq(s.routingRules.orgId, org.id)).limit(1);
    if (existingRules.length === 0) {
      await tx.insert(s.routingRules).values([
        { orgId: org.id, position: 1, name: "Asylum applications: offer a consultation on other routes", action: "consult", flag: "asylum", match: { keywordsAny: ["asylum"] } },
        { orgId: org.id, position: 2, name: "Australian immigration: authorised consultation process", action: "consult", flag: "regulated_au", match: { destinationIn: ["AU"] } },
        { orgId: org.id, position: 3, name: "Legal matters to Mimshac Group", action: "route", flag: "legal_matter", targetFirmId: firmIds.mimshac, match: { keywordsAny: LEGAL_KEYWORDS } },
        { orgId: org.id, position: 4, name: "Clients in Zimbabwe to Mimshac Group", action: "route", targetFirmId: firmIds.mimshac, match: { currentCountryIn: ["ZW"] } },
        { orgId: org.id, position: 5, name: "Investment and corporate migration to Nextmove Advisory", action: "route", targetFirmId: firmIds.nextmove, match: { keywordsAny: CORPORATE_KEYWORDS } },
        { orgId: org.id, position: 6, name: "Everything else to Veritas Emigrate", action: "route", targetFirmId: firmIds.veritas, match: {} },
      ]);
      log("  + routing rules");
    }

    // Services from the approved fee schedule
    const parsed = parseFeeSchedule(readFileSync(join(process.cwd(), "data/config/fee-schedule-za-2026-10-20.md"), "utf8"));
    for (const f of FIRMS.filter((x) => x.feeSchedule)) {
      for (const p of parsed) {
        await tx
          .insert(s.services)
          .values({
            firmId: firmIds[f.slug], code: p.code, name: p.name, jurisdiction: "ZA", category: p.category, currency: "ZAR",
            totalMinor: p.totalMinor, depositMinor: p.depositMinor, lines: p.lines, addOns: p.addOns,
            sourceNote: "Fee schedule, 20 Oct 2026",
          })
          .onConflictDoNothing();
      }
    }
    const warnings = parsed.filter((p) => p.warnings.length);
    log(`  services: ${parsed.length} per firm (${warnings.length} with notes)`);
    for (const w of warnings) log(`    ! ${w.name}: ${w.warnings.join(" ")}`);
  });
}
