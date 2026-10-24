import type { Metadata } from "next";
import { HubLogo } from "@/components/hub-mark";

export const metadata: Metadata = { title: "Payment received" };

export default function PaymentThanks() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="max-w-md rounded-2xl border border-hairline bg-surface p-8 text-center">
        <HubLogo className="mx-auto mb-6 h-[17px] w-auto" />
        <h1 className="font-display text-3xl text-ink">Thank you</h1>
        <p className="mt-3 text-sm text-ink-2">Your payment has been submitted. You&apos;ll receive a receipt by email, and your case manager will confirm once it has been received.</p>
      </div>
    </main>
  );
}
