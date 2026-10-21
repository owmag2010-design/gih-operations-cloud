/** Start of the reporting window: now minus `days`. */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}
