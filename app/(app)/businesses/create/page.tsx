import { routes, withSearchParams } from "@/lib/routes";
import { redirect } from "next/navigation";

type CreateBusinessCompatibilityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CreateBusinessCompatibilityPage({
  searchParams,
}: CreateBusinessCompatibilityPageProps) {
  redirect(withSearchParams(routes.salons.create(), await searchParams));
}
