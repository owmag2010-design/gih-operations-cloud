/**
 * Parser for the approved fee-schedule markdown (data/config/fee-schedule-*.md).
 * Pure function so it can be unit-tested; used by the seed script.
 */
import type { ServiceAddOn, ServiceLine } from "../../db/schema";

export type ParsedService = {
  code: string;
  name: string;
  category: string;
  totalMinor: number;
  depositMinor: number;
  lines: ServiceLine[];
  addOns: ServiceAddOn[];
  warnings: string[];
};

const rand = (s: string) => Math.round(Number(s.replace(/[R,\s]/g, "")) * 100);

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/→/g, " to ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function categoryFor(name: string): string {
  const n = name.toLowerCase();
  if (/consultation/.test(n)) return "Consultation";
  if (/appeal|mandamus|compel|good cause|undesirab|v-list|prohibited/.test(n)) return "Legal & appeals";
  if (/^pr |permanent residence|citizenship/.test(n)) return "Permanent residence & citizenship";
  if (/work visa|critical skills|intra-company|dti|business/.test(n)) return "Work & business";
  if (/certificate|apostille|saqa|impediment|courier|assisted|police clearance/.test(n)) return "Documents & ancillary";
  return "Temporary residence";
}

function lineKind(label: string): ServiceLine["kind"] {
  const l = label.toLowerCase();
  if (l.startsWith("professional fee") || l.startsWith("immigration consultation") || l.startsWith("consultation")) return "professional";
  if (l.includes("vfs application fee")) return "government";
  return "third_party";
}

export function parseFeeSchedule(markdown: string): ParsedService[] {
  const out: ParsedService[] = [];
  const blocks = markdown.split(/\n(?=## )/).filter((b) => b.startsWith("## "));
  const seen = new Set<string>();

  for (const block of blocks) {
    const [header, ...rest] = block.split("\n");
    const m = header.match(/^##\s+(.+?)\s+—\s+(R[\d,]+)\s+\(deposit\s+(R[\d,]+)\)\s*$/);
    if (!m) continue;
    const name = m[1].trim().replace(/\s+—\s+$/, "");
    const totalMinor = rand(m[2]);
    const listedDeposit = rand(m[3]);
    const lines: ServiceLine[] = [];
    const addOns: ServiceAddOn[] = [];
    const warnings: string[] = [];

    for (const raw of rest) {
      const line = raw.trim();
      if (!line.startsWith("- ")) continue;
      const body = line.slice(2);
      if (/^add-ons?:/i.test(body)) {
        for (const part of body.replace(/^add-ons?:\s*/i, "").split(/;\s*/)) {
          const am = part.match(/^(.*?)\s+(R[\d,]+)$/);
          if (am) addOns.push({ label: am[1].trim(), amountMinor: rand(am[2]) });
          else addOns.push({ label: part.replace(/\s+(TBC|at cost)$/i, "").trim(), amountMinor: null, note: /at cost/i.test(part) ? "At cost" : "To be confirmed" });
        }
        continue;
      }
      const lm = body.match(/^(.*):\s+(R[\d,]+)$/);
      if (lm) lines.push({ label: lm[1].trim(), amountMinor: rand(lm[2]), kind: lineKind(lm[1]) });
    }

    const sum = lines.reduce((a, l) => a + l.amountMinor, 0);
    if (sum !== totalMinor) warnings.push(`Lines add up to R${sum / 100} but the total is R${totalMinor / 100}.`);

    const category = categoryFor(name);
    // Business rule: consultations are paid in full; everything else is a 50% deposit.
    const depositMinor = category === "Consultation" ? totalMinor : Math.round(totalMinor / 2);
    if (category !== "Consultation" && depositMinor !== listedDeposit) warnings.push(`Listed deposit differs from 50% of the total.`);

    let code = slugify(name);
    while (seen.has(code)) code = `${code}-2`;
    seen.add(code);
    out.push({ code, name: name.charAt(0).toUpperCase() + name.slice(1), category, totalMinor, depositMinor, lines, addOns, warnings });
  }
  return out;
}
