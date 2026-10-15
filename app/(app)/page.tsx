import { withExperiencePage } from "@/components/experience-page";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { redirect } from "next/navigation";

async function HomePage() {
  const context = await getCurrentBusinessContext();

  redirect(context.user ? context.defaultRouteForCurrentContext : "/explore");
}

export default withExperiencePage(HomePage);
