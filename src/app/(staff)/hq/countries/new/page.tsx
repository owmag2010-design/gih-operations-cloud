import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { requireStaff } from "@/server/next/session";
import { ProfileForm } from "../client";

export const metadata: Metadata = { title: "Add a country" };

export default async function NewCountryPage() {
  const { ctx } = await requireStaff();
  if (!ctx.has("countries:manage")) notFound();
  return (
    <>
      <PageHeader title="Add a country" description="The new country starts as a draft. Nothing client-facing uses it until a reviewer has verified it and made it operational." />
      <Panel className="max-w-4xl">
        <PanelHeader title="Country profile" />
        <ProfileForm
          mode="create"
          canEdit
          initial={{ code: "", name: "", currency: "USD", dateFormat: "dd/MM/yyyy", phonePrefix: "", timezones: "", defaultTimezone: "", addressFormat: "line1 | Street address | required\ncity | City or town | required\npostcode | Postcode", authorities: "", notes: "" }}
        />
      </Panel>
    </>
  );
}
