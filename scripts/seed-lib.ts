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
import { DOCUMENT_STARTERS } from "./document-starters";
import type { EmailBlock } from "../src/server/db/schema";
import { sanitizeTemplateHtml } from "../src/server/modules/email/html-template";

/** Starter templates: wording only, no client data. Each firm can copy and adapt them. */
const STARTER_TEMPLATES: { name: string; category: string; subject: string; preheader: string; blocks: EmailBlock[] }[] = [
  {
    name: "Enquiry received", category: "Enquiries", subject: "We've received your enquiry, {{first_name}}", preheader: "What happens next with your immigration enquiry.",
    blocks: [
      { type: "heading", text: "Thank you, {{first_name}}" },
      { type: "paragraph", text: "We've received your enquiry and a specialist will review it. You'll hear from us within one working day with the right next step for your situation." },
      { type: "notice", text: "Your reference is **{{reference}}**. Please quote it if you contact us." },
      { type: "paragraph", text: "If anything is urgent, such as a deadline or a visa expiring soon, reply to this email and tell us the date." },
    ],
  },
  {
    name: "Book a consultation", category: "Consultations", subject: "Your consultation with {{firm_name}}", preheader: "Choose a time that suits you.",
    blocks: [
      { type: "heading", text: "Let's talk through your options" },
      { type: "paragraph", text: "Hi {{first_name}},\n\nThe best next step is a consultation, where we look at your circumstances and confirm the right route before you spend money on documents." },
      { type: "details", rows: [{ label: "Length", value: "60 minutes" }, { label: "Where", value: "Video call or at a Global Immigration Hub centre" }] },
      { type: "button", label: "Choose a time", url: "https://thegih.com" },
    ],
  },
  {
    name: "Documents needed", category: "Matters", subject: "Documents we need for your application", preheader: "A short list of what to send us next.",
    blocks: [
      { type: "heading", text: "Your next documents" },
      { type: "paragraph", text: "Hi {{first_name}},\n\nTo keep your application moving, please send us the documents below. Clear phone photos or scans are fine." },
      { type: "details", rows: [{ label: "Document", value: "Details" }] },
      { type: "notice", text: "Reply to this email with the documents attached. Quote **{{reference}}**." },
    ],
  },
  {
    name: "Proposal follow-up", category: "Proposals", subject: "Following up on your proposal", preheader: "Any questions about the proposal we sent?",
    blocks: [
      { type: "paragraph", text: "Hi {{first_name}},\n\nI wanted to check whether you've had a chance to look at the proposal we sent, and whether you have any questions about the scope or fees." },
      { type: "paragraph", text: "If you're ready to begin, accepting the proposal and paying the deposit lets us start straight away." },
    ],
  },
  {
    name: "Payment received", category: "Finance", subject: "Payment received, thank you", preheader: "We've received your payment and work is under way.",
    blocks: [
      { type: "heading", text: "Payment received" },
      { type: "paragraph", text: "Hi {{first_name}},\n\nThank you. We've received your payment and your matter is now active. We'll send your document checklist shortly." },
      { type: "notice", text: "Reference: **{{reference}}**" },
    ],
  },
];
import * as s from "../src/server/db/schema";
import { DEFAULT_PIPELINE } from "../src/server/modules/crm/pipeline-defaults";
import { DEFAULT_MATTER_STAGES } from "../src/server/modules/matters/defaults";
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
      // Default matter stages (only when the practice has none yet, so edits are kept)
      const [hasStages] = await tx.select({ id: s.matterStages.id }).from(s.matterStages).where(eq(s.matterStages.firmId, firm.id)).limit(1);
      if (!hasStages) {
        for (const [i, st] of DEFAULT_MATTER_STAGES.entries()) {
          await tx.insert(s.matterStages).values({ firmId: firm.id, key: st.key, name: st.name, category: st.category, position: i }).onConflictDoNothing();
        }
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
    // Airtable mirror: register configured tables (existing ones keep their state and edits)
    {
      const cfg = JSON.parse(readFileSync(join(process.cwd(), "data/config/airtable-sources.json"), "utf8")) as {
        sources: { base: string; baseName: string; table: string; tableName: string; dataset: string; firm: string | null; mapsTo: string | null; truth: "airtable" | "dashboard" | "shared"; note: string | null }[];
      };
      for (const [i, c] of cfg.sources.entries()) {
        const firmId = c.firm ? firmIds[c.firm] : null;
        if (c.firm && !firmId) continue;
        await tx
          .insert(s.airtableSources)
          .values({ orgId: org.id, firmId, baseId: c.base, baseName: c.baseName, tableId: c.table, tableName: c.tableName, dataset: c.dataset, mapsTo: c.mapsTo, sourceOfTruth: c.truth, truthNote: c.note, position: i })
          .onConflictDoNothing();
      }
    }

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
    // Every service starts its price history at version 1.
    await tx.execute(sql`
      insert into service_price_versions (firm_id, service_id, version, name, currency, total_minor, deposit_minor, lines, add_ons, is_active, reason, created_at)
      select s.firm_id, s.id, 1, s.name, s.currency, s.total_minor, s.deposit_minor, s.lines, s.add_ons, s.is_active, coalesce(s.source_note, 'Initial fee schedule'), s.created_at
      from services s where not exists (select 1 from service_price_versions v where v.service_id = s.id)`);
    // Email: one receiving address per inbox on the Resend receiving domain, and starter templates.
    const MAIL_DOMAIN = process.env.INBOUND_EMAIL_DOMAIN ?? "in.thegih.com";
    const boxes: { firm: string | null; label: string; local: string; forwardedFrom: string; fromName: string; fromAddress: string }[] = [
      { firm: null, label: "Global Immigration Hub", local: "hello", forwardedFrom: "hello@thegih.com", fromName: "Global Immigration Hub", fromAddress: "hello@thegih.com" },
      { firm: "veritas", label: "Veritas Emigrate", local: "veritas", forwardedFrom: "Veritas mailbox", fromName: "Veritas Emigrate", fromAddress: "veritas@thegih.com" },
      { firm: "mimshac", label: "Mimshac Group", local: "mimshac", forwardedFrom: "owen@mimshacgroup.com", fromName: "Mimshac Group", fromAddress: "mimshac@thegih.com" },
      { firm: "nextmove", label: "Nextmove Advisory", local: "nextmove", forwardedFrom: "Nextmove mailbox", fromName: "Nextmove Advisory", fromAddress: "nextmove@thegih.com" },
    ];
    for (const b of boxes) {
      await tx
        .insert(s.mailboxes)
        .values({ orgId: org.id, firmId: b.firm ? firmIds[b.firm] : null, label: b.label, inboundAddress: `${b.local}@${MAIL_DOMAIN}`, forwardedFrom: b.forwardedFrom, fromName: b.fromName, fromAddress: b.fromAddress })
        .onConflictDoNothing({ target: s.mailboxes.inboundAddress });
    }
    const [{ n: templateCount }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.emailTemplates).where(eq(s.emailTemplates.orgId, org.id));
    if (templateCount === 0) {
      await tx.insert(s.emailTemplates).values(STARTER_TEMPLATES.map((t) => ({ ...t, orgId: org.id, firmId: null })));
      log(`  + ${STARTER_TEMPLATES.length} starter email templates (Hub, shared with firms)`);
    }
    // Starter document templates for each practice (structure only; added once, never overwritten).
    let starters = 0;
    for (const slug of Object.keys(firmIds)) {
      for (const d of DOCUMENT_STARTERS) {
        const [row] = await tx.insert(s.documentTemplates).values({ firmId: firmIds[slug], kind: d.kind, name: d.name, description: d.description, content: d.content, isStarter: true }).onConflictDoNothing().returning();
        if (row) {
          await tx.insert(s.documentTemplateVersions).values({ firmId: row.firmId, templateId: row.id, version: 1, name: row.name, content: row.content });
          starters++;
        }
      }
    }
    if (starters) log(`  + ${starters} starter document templates`);
    // Imported HTML templates (designs taken from sent emails and the Veritas template folder; no client data).
    let imported = 0;
    for (const [dir, firmSlug, manifestName] of [["gih", null, "manifest.json"], ["veritas", "veritas", "manifest-html.json"]] as const) {
      const base = join(__dirname, "..", "data", "email-templates-import", dir);
      let manifest: { file: string; name: string; category: string; subject: string; preheader: string | null; slots: { key: string; label: string; default: string; multiline: boolean }[]; source: string }[];
      try {
        manifest = JSON.parse(readFileSync(join(base, manifestName), "utf8"));
      } catch {
        continue;
      }
      const firmId = firmSlug ? firmIds[firmSlug] : null;
      for (const m of manifest) {
        const [exists] = await tx
          .select({ id: s.emailTemplates.id })
          .from(s.emailTemplates)
          .where(and(eq(s.emailTemplates.orgId, org.id), eq(s.emailTemplates.name, m.name), firmId ? eq(s.emailTemplates.firmId, firmId) : sql`${s.emailTemplates.firmId} is null`));
        if (exists) continue;
        const html = sanitizeTemplateHtml(readFileSync(join(base, m.file), "utf8"));
        await tx.insert(s.emailTemplates).values({ orgId: org.id, firmId, name: m.name, category: m.category, subject: m.subject, preheader: m.preheader, format: "html", html, slots: m.slots, blocks: [], sourceNote: m.source });
        imported++;
      }
    }
    if (imported) log(`  + ${imported} imported HTML email templates`);
    const warnings = parsed.filter((p) => p.warnings.length);
    log(`  services: ${parsed.length} per firm (${warnings.length} with notes)`);
    for (const w of warnings) log(`    ! ${w.name}: ${w.warnings.join(" ")}`);
  });
}
