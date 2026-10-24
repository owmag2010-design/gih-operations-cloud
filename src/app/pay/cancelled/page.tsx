import type { Metadata } from "next";
import { HubLogo } from "@/components/hub-mark";

export const metadata: Metadata = { title: "Payment not completed" };

export default function PaymentCancelled() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="max-w-md rounded-2xl border border-hairline bg-surface p-8 text-center">
        <HubLogo className="mx-auto mb-6 h-[17px] w-auto" />
        <h1 className="font-display text-3xl text-ink">Payment not completed</h1>
        <p className="mt-3 text-sm text-ink-2">No payment was taken. You can use the same payment link again, or contact your case manager for other ways to pay.</p>
      </div>
    </main>
  );
}
