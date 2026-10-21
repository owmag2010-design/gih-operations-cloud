import type { Metadata } from "next";
import Link from "next/link";
import { getInvitationForToken } from "@/server/auth/service";
import { AuthShell } from "../../auth-shell";
import { AcceptInvitationForm } from "../../forms";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invite = await getInvitationForToken(token);
  if (!invite) {
    return (
      <AuthShell title="This invitation can't be used" description="It may have expired, been replaced by a newer invitation, or already been accepted. Ask whoever invited you to send a new one.">
        <Link href="/login" className="text-[13px] text-accent hover:underline">Go to sign in</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title={`Join ${invite.firmName ?? "Global Immigration Hub"}`}
      description={<>You&apos;ve been invited as <span className="text-ink">{invite.roleName}</span>, using {invite.email}.</>}
    >
      <AcceptInvitationForm token={token} name={invite.name} email={invite.email} existingAccount={invite.existingAccount} />
    </AuthShell>
  );
}
