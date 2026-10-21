/**
 * Read and sanity-check MIGRATION_DATABASE_URL before connecting, so a
 * mistyped secret fails with a clear message. Never prints the password.
 */
export function migrationUrl(): string {
  const raw = process.env.MIGRATION_DATABASE_URL;
  if (!raw) throw new Error("MIGRATION_DATABASE_URL is not set");
  const url = raw.trim();
  const problems: string[] = [];
  if (/^["']|["']$/.test(url)) problems.push("it is wrapped in quotes; remove them");
  if (!/^postgres(ql)?:\/\//.test(url)) problems.push('it must start with "postgresql://"');
  if (/\s/.test(url)) problems.push("it contains a space or line break");

  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    problems.push("it is not a valid URL (if the password has symbols such as @ # / ? %, percent-encode them)");
  }
  if (parsed) {
    if (!parsed.hostname || !parsed.hostname.includes(".")) problems.push(`the host "${parsed.hostname}" doesn't look like a database host`);
    if (!parsed.username) problems.push("the user name is missing");
    if (!parsed.password) problems.push("the password is missing");
    if (parsed.password && /^\[.*\]$/.test(decodeURIComponent(parsed.password))) problems.push("the password still has the [ ] placeholder brackets");
  }
  if (problems.length) {
    throw new Error(`MIGRATION_DATABASE_URL looks wrong: ${problems.join("; ")}. Expected postgresql://USER:PASSWORD@HOST:PORT/postgres`);
  }
  console.log(`Connecting as ${parsed!.username} to ${parsed!.hostname}:${parsed!.port || "5432"}${parsed!.pathname}`);
  return url;
}
