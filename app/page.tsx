import { getCurrentBusinessContext } from "@/lib/current-context";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const context = await getCurrentBusinessContext();

  redirect(context.user ? context.defaultRouteForCurrentContext : "/explore");
}
