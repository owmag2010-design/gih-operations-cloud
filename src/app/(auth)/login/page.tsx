import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui/primitives";
import { currentSession } from "@/server/next/session";
import { AuthShell } from "../auth-shell";
import { SignInForm } from "../forms";

export const metadata: Metadata = { title: "Sign in" };

const REASONS: Record<string, { tone: "ok" | "warn"; text: string }> = {
  reset: { tone: "ok", text: "Password updated. Sign in with your new password." },
  inactive: { tone: "warn", text: "Your account isn't active. Contact a Hub administrator." },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await currentSession();
  if (session && (!session.user.mfaEnabled || session.mfaVerified)) redirect("/");
  const { reason } = await searchParams;
  const notice = typeof reason === "string" ? REASONS[reason] : undefined;
  return (
    <AuthShell title="Sign in" description="For staff of Global Immigration Hub and its partner firms.">
      {notice ? <Notice tone={notice.tone} className="mb-4">{notice.text}</Notice> : null}
      <SignInForm />
    </AuthShell>
  );
}
