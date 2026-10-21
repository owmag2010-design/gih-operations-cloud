import type { Metadata } from "next";
import { AuthShell } from "../auth-shell";
import { RequestResetForm } from "../forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetRequestPage() {
  return (
    <AuthShell title="Reset your password" description="We'll email you a link to choose a new one.">
      <RequestResetForm />
    </AuthShell>
  );
}
