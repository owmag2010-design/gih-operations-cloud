import { NextResponse, type NextRequest } from "next/server";

/**
 * Network-edge checks only: security headers and a fast redirect for visitors
 * with no session cookie. Real authentication and authorisation happen on the
 * server, close to the data (see src/server/next/session.ts).
 */
const PUBLIC = [/^\/p\/[A-Za-z0-9_-]+(\/pdf)?$/, /^\/login/, /^\/invite\//, /^\/reset-password/, /^\/api\/intake\//, /^\/api\/health$/, /^\/_next\//, /^\/favicon/];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("gih_session") || request.cookies.has("__Host-gih_session");

  let response: NextResponse;
  if (!hasSession && !PUBLIC.some((r) => r.test(pathname)) && pathname !== "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next();
  }

  const dev = process.env.NODE_ENV !== "production";
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self'${dev ? " ws: wss:" : ""}`,
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  );
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (!dev) response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
