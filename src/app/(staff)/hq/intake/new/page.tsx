import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { requireStaff } from "@/server/next/session";
import { CaptureForm } from "./form";

export const metadata: Metadata = { title: "Capture an enquiry" };

export default async function NewIntakePage() {
  const { ctx } = await requireStaff();
  if (!ctx.has("intake:create")) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Capture an enquiry" description="For enquiries by phone, email or walk-in. The routing rules suggest a firm as soon as you save." />
      <CaptureForm />
    </div>
  );
}
