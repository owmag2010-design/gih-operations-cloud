"use client";

/**
 * Sandboxed view of an email's HTML: no scripts, no same-origin access. Inside
 * the frame nothing loads from the internet (tracking pixels, remote CSS)
 * unless it's our own preview (`allowSameSiteImages`), where brand images on
 * https are allowed.
 */
const FRAME_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:">`;

export function EmailFrame({ html, title, height = 520, allowSameSiteImages = false }: { html: string; title: string; height?: number; allowSameSiteImages?: boolean }) {
  const csp = allowSameSiteImages ? FRAME_CSP.replace("img-src data: cid:", "img-src data: cid: https:") : FRAME_CSP;
  const doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${csp}`) : `${csp}${html}`;
  return <iframe title={title} sandbox="" srcDoc={doc} className="w-full rounded-md border border-hairline bg-white" style={{ height }} />;
}
