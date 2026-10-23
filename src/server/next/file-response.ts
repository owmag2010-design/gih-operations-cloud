import "server-only";

/** A stored file as a download. Only images and PDFs may open inline; everything is sandboxed. */
export function fileResponse(f: { data: Buffer; contentType: string; filename: string; size: number }, inline: boolean) {
  const safeInline = inline && /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/.test(f.contentType);
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": safeInline ? f.contentType : "application/octet-stream",
      "Content-Length": String(f.size),
      "Content-Disposition": `${safeInline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

