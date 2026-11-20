import "server-only";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Client emails in the approved Global Immigration Hub layout: logo, navy header
 * with the matter, cream panel with a red rule for the one thing to do. Only
 * borders and text colours carry meaning, so clients that strip backgrounds
 * still read it.
 */
export function clientEmail(opts: {
  kicker: string;
  heading: string;
  subline: string;
  greeting: string;
  body: string[];
  panelTitle?: string;
  panelLines?: string[];
  actionLabel: string;
  actionUrl: string;
  footer: string;
}) {
  const panel = opts.panelTitle
    ? `<tr><td style="padding:6px 36px 4px"><div style="background:#F7F4EF;border-left:4px solid #DD1929;padding:14px 18px;font-size:14px;line-height:22px;color:#2B3445"><b>${esc(opts.panelTitle)}</b>${(opts.panelLines ?? []).map((l) => `<br>${esc(l)}`).join("")}</div></td></tr>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#F7F4EF">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#F7F4EF"><tr><td align="center" style="padding:24px 12px">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:600px;background:#ffffff;font-family:Helvetica,Arial,sans-serif;color:#1B263B">
<tr><td style="padding:24px 36px 18px"><img src="https://thegih.com/assets/email/gih-sig-logo.png" width="230" alt="Global Immigration Hub" style="display:block;width:230px;border:0"></td></tr>
<tr><td style="background:#1B263B;border-bottom:4px solid #DD1929;padding:22px 36px">
<div style="font-size:11px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:#F2B8BD">${esc(opts.kicker)}</div>
<div style="font-family:Georgia,serif;font-size:24px;line-height:30px;color:#ffffff;margin-top:8px">${esc(opts.heading)}</div>
<div style="font-size:14px;color:#DDE3EA;margin-top:6px">${esc(opts.subline)}</div></td></tr>
<tr><td style="padding:26px 36px 4px;font-size:15px;line-height:25px;color:#2B3445">
<p style="margin:0 0 14px">${esc(opts.greeting)}</p>
${opts.body.map((p) => `<p style="margin:0 0 14px">${esc(p)}</p>`).join("")}</td></tr>
${panel}
<tr><td style="padding:18px 36px 8px"><a href="${esc(opts.actionUrl)}" style="display:inline-block;background:#DD1929;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:bold">${esc(opts.actionLabel)}</a></td></tr>
<tr><td style="padding:12px 36px 22px;font-size:12px;line-height:18px;color:#6B7280">${esc(opts.footer)}</td></tr>
<tr><td style="background:#1B263B;padding:16px 36px;font-size:11px;color:#C9D2DD">Global Immigration Hub · Partner firms: Veritas Emigrate · Mimshac Group · Nextmove · thegih.com</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    opts.heading,
    opts.subline,
    "",
    opts.greeting,
    "",
    ...opts.body.flatMap((p) => [p, ""]),
    ...(opts.panelTitle ? [opts.panelTitle, ...(opts.panelLines ?? []), ""] : []),
    `${opts.actionLabel}: ${opts.actionUrl}`,
    "",
    opts.footer,
  ].join("\n");
  return { html, text };
}

/** Plain internal alert for the team. */
export function staffAlertEmail(opts: { heading: string; lines: string[]; quote?: string; actionLabel: string; actionUrl: string }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1c2331">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-top:4px solid #DD1929">
<tr><td style="padding:24px 28px">
<p style="margin:0 0 4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6b7280">Client portal · internal</p>
<h1 style="margin:0 0 14px;font-size:19px">${esc(opts.heading)}</h1>
${opts.lines.map((l) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5">${esc(l)}</p>`).join("")}
${opts.quote ? `<blockquote style="margin:14px 0;padding:10px 14px;border-left:3px solid #1B263B;background:#f4f5f7;font-size:14px;white-space:pre-wrap">${esc(opts.quote)}</blockquote>` : ""}
<p style="margin:18px 0 0"><a href="${esc(opts.actionUrl)}" style="display:inline-block;background:#1B263B;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:7px;font-size:14px">${esc(opts.actionLabel)}</a></p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [opts.heading, "", ...opts.lines, ...(opts.quote ? ["", `"${opts.quote}"`] : []), "", `${opts.actionLabel}: ${opts.actionUrl}`].join("\n");
  return { html, text };
}
