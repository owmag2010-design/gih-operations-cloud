import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/next/session";
import { signOutAction } from "../../actions";
import { AuthShell } from "../../auth-shell";
import { MfaChallengeForm } from "../../forms";

export const metadata: Metadata = { title: "Two-step sign-in" };

export default async function MfaPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.user.mfaEnabled || session.mfaVerified) redirect("/");
  return (
    <AuthShell title="Enter your code" description={`Signing in as ${session.user.email}.`}>
      <MfaChallengeForm />
      <form action={signOutAction} className="mt-4">
        <button className="text-[13px] text-accent hover:underline">Use a different account</button>
      </form>
    </AuthShell>
  );
}
