import { withExperiencePage } from "@/components/experience-page";
import { routes, withSearchParams } from "@/lib/routes";
import { redirect } from "next/navigation";

type BusinessesCompatibilityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function BusinessesCompatibilityPage({
  searchParams,
}: BusinessesCompatibilityPageProps) {
  redirect(withSearchParams(routes.salons.list(), await searchParams));
}

export default withExperiencePage(BusinessesCompatibilityPage);
