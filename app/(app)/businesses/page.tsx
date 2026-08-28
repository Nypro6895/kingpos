import { routes, withSearchParams } from "@/lib/routes";
import { redirect } from "next/navigation";

type BusinessesCompatibilityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BusinessesCompatibilityPage({
  searchParams,
}: BusinessesCompatibilityPageProps) {
  redirect(withSearchParams(routes.salons.list(), await searchParams));
}
