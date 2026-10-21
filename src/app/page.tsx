import { redirect } from "next/navigation";
import { landingPath } from "./(auth)/actions";

export default async function Home() {
  redirect(await landingPath());
}
