import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { requireStaff } from "@/server/next/session";
import { CreateFirmForm } from "../client";

export const metadata: Metadata = { title: "Add a firm" };

export default async function NewFirmPage() {
  const { ctx } = await requireStaff();
  if (!ctx.has("firms:create")) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add a firm" description="Creates a separate workspace with its own records, pipeline and team. No data is shared with the other firms." />
      <CreateFirmForm />
    </div>
  );
}
