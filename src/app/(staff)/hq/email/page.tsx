import { redirect } from "next/navigation";

export default function EmailSettingsRedirect() {
  redirect("/settings/email");
}
