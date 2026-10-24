/**
 * Date arithmetic for deadlines, on calendar dates (YYYY-MM-DD) with no time
 * zone, so a deadline is the same day wherever it is viewed.
 */

export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function parse(v: string) {
  if (!isIsoDate(v)) throw new Error(`Invalid date: ${v}`);
  return new Date(`${v}T00:00:00Z`);
}

export function addCalendarDays(from: string, days: number): string {
  const d = parse(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Add business days (Monday to Friday). Public holidays are not excluded;
 * the basis text says so and a reviewer can adjust the result.
 */
export function addBusinessDays(from: string, days: number): string {
  const d = parse(from);
  const step = days >= 0 ? 1 : -1;
  let left = Math.abs(days);
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}
