import "server-only";
import { env } from "../env";

/** Minimal Anthropic Messages API client for drafting assistance. */
export type DraftRequest = { system: string; prompt: string; maxTokens?: number };
type Drafter = (r: DraftRequest) => Promise<string>;

let double: Drafter | null = null;
/** Tests replace the model; pass null to restore it. */
export function __setDrafterTestDouble(fn: Drafter | null) {
  double = fn;
}

export function aiConfigured() {
  return !!double || !!env().ANTHROPIC_API_KEY;
}

export async function draftText(r: DraftRequest): Promise<string> {
  if (double) return double(r);
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI drafting isn't configured.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: env().ANTHROPIC_MODEL, max_tokens: r.maxTokens ?? 4000, system: r.system, messages: [{ role: "user", content: r.prompt }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`The drafting service returned ${res.status}.`);
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
}
