/**
 * Hub routing engine (pure). Rules are evaluated in position order; the first
 * active rule whose conditions all match wins. An empty rule matches anything
 * (catch-all). Enquiries with too little information are held for a person.
 */
import type { RoutingMatch } from "../../db/schema";

export type RuleLike = {
  id: string;
  name: string;
  position: number;
  isActive: boolean;
  match: RoutingMatch;
  action: "route" | "hold" | "consult";
  targetFirmId: string | null;
  flag: string | null;
};

export type EnquiryLike = {
  enquiry?: string | null;
  immigrationCategory?: string | null;
  currentCountry?: string | null;
  destinationCountry?: string | null;
};

export type RoutingDecision = {
  action: "route" | "hold" | "consult";
  firmId: string | null;
  ruleId: string | null;
  reason: string;
  flags: string[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();

/** Whole-word (or whole-phrase) keyword match, so "ban" does not match "bank". */
export function containsKeyword(text: string, keyword: string): boolean {
  const t = ` ${norm(text)} `;
  const k = norm(keyword);
  if (!k) return false;
  return t.includes(` ${k} `);
}

function matches(rule: RuleLike, e: EnquiryLike): boolean {
  const m = rule.match ?? {};
  const text = `${e.enquiry ?? ""} ${e.immigrationCategory ?? ""}`;
  if (m.keywordsAny?.length && !m.keywordsAny.some((k) => containsKeyword(text, k))) return false;
  if (m.currentCountryIn?.length && !(e.currentCountry && m.currentCountryIn.includes(e.currentCountry))) return false;
  if (m.destinationIn?.length && !(e.destinationCountry && m.destinationIn.includes(e.destinationCountry))) return false;
  return true;
}

export function decideRoute(rules: RuleLike[], e: EnquiryLike): RoutingDecision {
  const hasContent = (e.enquiry ?? "").trim().length >= 3 || (e.immigrationCategory ?? "").trim().length > 0;
  if (!hasContent) {
    return { action: "hold", firmId: null, ruleId: null, reason: "Not enough information to route. A person needs to review it.", flags: ["needs_information"] };
  }
  const flags: string[] = [];
  for (const rule of [...rules].filter((r) => r.isActive).sort((a, b) => a.position - b.position)) {
    if (!matches(rule, e)) continue;
    if (rule.flag) flags.push(rule.flag);
    if (rule.action === "route" && rule.targetFirmId) {
      return { action: "route", firmId: rule.targetFirmId, ruleId: rule.id, reason: rule.name, flags };
    }
    return { action: rule.action === "route" ? "hold" : rule.action, firmId: rule.targetFirmId, ruleId: rule.id, reason: rule.name, flags };
  }
  return { action: "hold", firmId: null, ruleId: null, reason: "No routing rule matched.", flags };
}
