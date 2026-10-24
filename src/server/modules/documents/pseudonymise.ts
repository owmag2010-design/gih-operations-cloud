/**
 * Replace people's names with neutral labels before text leaves the app for
 * AI drafting, and put the real names back in the draft that returns. The
 * model sees the facts but not who they are about.
 */
export type Person = { label: string; firstName: string; lastName: string | null };

export function makePseudonymiser(people: Person[]) {
  const pairs: [string, string][] = [];
  people.forEach((p, i) => {
    const token = `${p.label.toUpperCase().replace(/[^A-Z]+/g, "_")}_${i + 1}`;
    const full = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
    if (full && full !== p.firstName) pairs.push([full, token]);
    if (p.firstName.trim().length > 1) pairs.push([p.firstName.trim(), `${token}_FIRST`]);
    if (p.lastName && p.lastName.trim().length > 1) pairs.push([p.lastName.trim(), `${token}_LAST`]);
  });
  // Longest first, so "Thandi Mokoena" is replaced before "Thandi".
  const forward = [...pairs].sort((a, b) => b[0].length - a[0].length);
  const back = [...pairs].sort((a, b) => b[1].length - a[1].length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    hide(text: string) {
      let out = text;
      for (const [real, token] of forward) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(real)}(?![\\p{L}\\p{N}])`, "giu"), token);
      return out;
    },
    reveal(text: string) {
      let out = text;
      for (const [real, token] of back) out = out.replace(new RegExp(`\\b${esc(token)}\\b`, "g"), real);
      return out;
    },
    tokens: pairs.map(([, t]) => t),
  };
}
