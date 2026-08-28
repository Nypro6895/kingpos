import { routes, withSearchParams } from "@/lib/routes";
import { redirect } from "next/navigation";

type NewBusinessCompatibilityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewBusinessCompatibilityPage({
  searchParams,
}: NewBusinessCompatibilityPageProps) {
  redirect(withSearchParams(routes.salons.create(), await searchParams));
}
