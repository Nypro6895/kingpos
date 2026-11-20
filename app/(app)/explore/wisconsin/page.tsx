import { withExperiencePage } from "@/components/experience-page";
import { redirect } from "next/navigation";

export const metadata = { title: "Wisconsin beauty directory | Reylumi" };

async function WisconsinDirectory({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = Array.isArray(params.q) ? params.q[0] : params.q;
  const category = Array.isArray(params.category) ? params.category[0] : params.category;
  const city = Array.isArray(params.city) ? params.city[0] : params.city;
  const target = new URLSearchParams({ location: city && city !== "All" ? `${city.slice(0, 160)}, WI` : "WI", scope: "fixed" });
  if (query?.trim()) target.set("q", query.trim().slice(0, 200));
  if (["Nails", "Hair", "Massage", "Tattoo", "Lashes"].includes(category ?? "")) target.set("category", category!);
  redirect(`/explore?${target}`);
}

export default withExperiencePage(WisconsinDirectory);
