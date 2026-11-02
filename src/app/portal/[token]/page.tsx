import type { Metadata, Viewport } from "next";
import { getPortalView, portalLinkInfo, tokenShape } from "@/server/modules/portal/client";
import "../portal.css";
import { PortalApp } from "./portal-app";
import { readPortalSession } from "./session";
import { SignIn } from "./sign-in";

export const metadata: Metadata = { title: { absolute: "Your application · Global Immigration Hub" }, robots: { index: false, follow: false }, referrer: "no-referrer" };
export const viewport: Viewport = { themeColor: "#1b263b", viewportFit: "cover" };

/** The client portal. The private link opens it; an emailed code proves it's the client. */
export default async function PortalPage({ params }: PageProps<"/portal/[token]">) {
  const { token } = await params;
  const session = tokenShape.test(token) ? await readPortalSession(token) : null;
  const view = session ? await getPortalView(session) : null;
  if (view) return <PortalApp token={token} view={view} />;

  const info = tokenShape.test(token) ? await portalLinkInfo(token) : null;
  return <SignIn token={token} info={info} />;
}
