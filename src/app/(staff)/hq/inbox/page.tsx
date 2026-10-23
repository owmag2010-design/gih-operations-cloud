import { redirect } from "next/navigation";

export default function HubInboxRedirect() {
  redirect("/inbox?practice=hub");
}
