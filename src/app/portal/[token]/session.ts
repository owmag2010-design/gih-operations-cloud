import "server-only";
import { cookies } from "next/headers";
import { sha256 } from "@/server/auth/crypto";

/** One cookie per portal link, so a person with two matters keeps both signed in. */
export const portalCookieName = (token: string) => `gih_portal_${sha256(token).slice(0, 16)}`;

const secure = () => process.env.NODE_ENV === "production";

export async function readPortalSession(token: string) {
  return (await cookies()).get(portalCookieName(token))?.value ?? null;
}

export async function setPortalSession(token: string, session: string) {
  (await cookies()).set(portalCookieName(token), session, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/portal",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export async function clearPortalSession(token: string) {
  (await cookies()).delete({ name: portalCookieName(token), path: "/portal" });
}
