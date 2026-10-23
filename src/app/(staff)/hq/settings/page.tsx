import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Settings" };

export default async function HubSettingsPage() {
  const { ctx } = await requireStaff();
  const items = [
    ctx.has("firms:view") && { href: "/hq/firms", title: "Practices", text: "Partner practices, their branding, reference prefixes and policies." },
    ctx.has("staff:view") && { href: "/hq/people", title: "People and roles", text: "Staff, invitations, Hub roles and practice memberships." },
    (ctx.has("routing:manage") || ctx.has("intake:view")) && { href: "/hq/routing", title: "Enquiry routing", text: "Which practice gets which Hub enquiry." },
    { href: "/settings/email", title: "Email", text: "Connected mailboxes, shared inboxes and the server's email connections." },
    { href: "/settings/signatures", title: "Signatures", text: "Your signature and each practice's default." },
    ctx.has("audit:view") && { href: "/hq/audit", title: "Audit log", text: "Who did what, across the organisation." },
  ].filter(Boolean) as { href: string; title: string; text: string }[];
  if (!items.length) notFound();
  return (
    <>
      <PageHeader title="Settings" description="Hub configuration." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="rounded-lg border border-hairline bg-surface p-4 hover:border-navy">
            <p className="text-[14px] font-semibold text-ink">{i.title}</p>
            <p className="mt-1 text-[13px] text-muted">{i.text}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
