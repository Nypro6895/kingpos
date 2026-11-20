import { withExperiencePage } from "@/components/experience-page";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NailInspirationCard } from "@/app/explore/nail-inspiration";
import { nailLookById } from "@/lib/nail-inspiration-catalog";
import { nailSalonEligible, nailSalonSearchInput } from "@/lib/nail-inspiration";
import { searchExploreSalons } from "@/lib/explore-search";

type Props = { params: Promise<{ lookId: string }>; searchParams: Promise<{ location?: string | string[] }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const look = nailLookById((await params).lookId);
  return { title: look ? `${look.title} · Nail inspiration | Reylumi` : "Nail inspiration | Reylumi", description: look?.alt };
}
async function NailInspirationPage({ params, searchParams }: Props) {
  const look = nailLookById((await params).lookId);
  if (!look) notFound();
  const raw = (await searchParams).location;
  const location = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 160) ?? "";
  const discovery = { location, strictLocation: true };
  const nearby = location ? await searchExploreSalons(nailSalonSearchInput(discovery)) : null;
  const salon = !nearby?.error ? nearby?.results.find(result => nailSalonEligible(result, discovery)) : undefined;
  const explore = `/explore?${new URLSearchParams({ q: `${look.colors[0]} ${look.shape} nail ideas`, type: "posts", ...(location ? { location, locationSource: "manual" } : {}) })}`;
  return <main className="mx-auto grid max-w-xl gap-4 px-4 py-6">
    <Link href={explore} className="w-fit text-sm font-semibold text-brand-teal">← Explore nearby nail ideas</Link>
    <h1 className="text-2xl font-semibold">{look.title}</h1>
    <NailInspirationCard look={look} salon={salon} location={location} />
    <p className="text-sm text-text-secondary">Your saved design stays the same wherever you go. Explore connects it with nail salons in your selected area.</p>
  </main>;
}

export default withExperiencePage(NailInspirationPage);
