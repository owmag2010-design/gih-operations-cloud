import type { Metadata } from "next";
import { AuthShell } from "../../auth-shell";
import { ResetPasswordForm } from "../../forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPage({ params }: PageProps<"/reset-password/[token]">) {
  const { token } = await params;
  return (
    <AuthShell title="Choose a new password" description="This signs you out on every device.">
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
