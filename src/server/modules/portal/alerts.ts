import "server-only";
import { env } from "../../env";
import { sendEmail } from "../../integrations/email";
import { staffAlertEmail } from "./emails";

export type AlertTargets = {
  orgId: string;
  firmId: string;
  firmSlug: string;
  firmName: string;
  firmEmail: string | null;
  matterId: string;
  matterRef: string;
  matterTitle: string;
  clientName: string;
  staff: { name: string; email: string }[];
};

/** Everyone a portal alert goes to: the matter team, the practice inbox and any configured copy. Deduplicated. */
export function alertRecipients(t: AlertTargets, copy = env().PORTAL_ALERT_COPY): string[] {
  const all = [...t.staff.map((s) => s.email), t.firmEmail, ...copy.split(",")]
    .map((e) => (e ?? "").trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  return [...new Set(all)];
}

export function matterLink(t: AlertTargets) {
  return `${env().APP_URL}/f/${t.firmSlug}/matters/${t.matterId}#portal`;
}

/** Tell the team. Failures are recorded (email outbox) but never block the client. */
export async function alertTeam(t: AlertTargets, event: { heading: string; lines: string[]; quote?: string }) {
  const link = matterLink(t);
  const mail = staffAlertEmail({
    heading: event.heading,
    lines: [`${t.clientName} · ${t.matterTitle} (${t.matterRef}) · ${t.firmName}`, ...event.lines],
    quote: event.quote,
    actionLabel: "Open the matter",
    actionUrl: link,
  });
  const recipients = alertRecipients(t);
  const results = await Promise.all(
    recipients.map((to) => sendEmail({ orgId: t.orgId, firmId: t.firmId, to, subject: `${event.heading} · ${t.matterRef}`, template: "portal_staff_alert", ...mail }).catch(() => ({ status: "failed" as const }))),
  );

  const hook = env().SLACK_PORTAL_WEBHOOK_URL;
  let slack: "sent" | "not_configured" | "failed" = "not_configured";
  if (hook) {
    try {
      const text = `*${event.heading}* · ${t.clientName} · ${t.matterRef} (${t.firmName})\n${event.lines.join("\n")}${event.quote ? `\n> ${event.quote.slice(0, 500).replace(/\n/g, "\n> ")}` : ""}\n<${link}|Open the matter>`;
      const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(8_000) });
      slack = res.ok ? "sent" : "failed";
    } catch {
      slack = "failed";
    }
  }
  return { emails: recipients.map((to, i) => ({ to, status: results[i].status })), slack };
}
