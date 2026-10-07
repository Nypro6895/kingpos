import {ExploreReferenceLove,ExploreBookButton} from "@/components/explore-account-actions";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { wisconsinBusinesses } from "@/lib/wisconsin-directory";
import { getDirectorySalonLinks } from "@/lib/salon-directory";

export default async function DirectoryBusinessPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const business = wisconsinBusinesses.find((entry) => entry.id === businessId);
  if (!business) notFound();
  const links = await getDirectorySalonLinks([businessId]);
  const link = links.get(businessId);
  if (link) redirect(`/explore/salons/${link.salonId}`);
  const address = `${business.address}, ${business.city}, WI ${business.postalCode}`;
  return <main className="mx-auto max-w-3xl space-y-8 px-5 py-8">
    <Link href="/explore/wisconsin" className="text-sm text-stone-600 underline">← Wisconsin directory</Link>
    <div className="flex justify-end gap-3"><ExploreReferenceLove itemKey={`directory:${businessId}`} name={business.name}/><ExploreBookButton name={business.name} contactHref={`/explore/wisconsin/${businessId}`} phoneHref={`tel:+1${business.phone.replace(/\D/g, "")}`}/></div>
    <header className="space-y-4">
      <p className="text-sm font-medium text-amber-800">{business.categories.join(" · ")} · Unclaimed listing</p>
      <h1 className="text-4xl font-semibold tracking-tight">{business.name}</h1>
      <p className="text-stone-600">Public reference information. The owner has not confirmed this profile.</p>
    </header>
    <section className="space-y-5 rounded-2xl border border-stone-200 p-6" aria-label="Contact information">
      <h2 className="text-xl font-semibold">Location & contact</h2>
      <dl className="space-y-4">
        <div><dt className="text-xs uppercase text-stone-500">Address</dt><dd className="mt-1">{address}</dd></div>
        <div><dt className="text-xs uppercase text-stone-500">Phone</dt><dd className="mt-1"><a className="text-xl font-semibold underline" href={`tel:+1${business.phone.replace(/\D/g, "")}`}>{business.phone}</a></dd></div>
        <div><dt className="text-xs uppercase text-stone-500">Email</dt><dd className="mt-1 min-h-6 break-all">{business.email ? <a className="underline" href={`mailto:${business.email}`}>{business.email}</a> : <span aria-label="No public email available" />}</dd></div>
      </dl>
      {business.notes && <p className="text-sm text-stone-600">{business.notes}</p>}
      <div className="flex flex-wrap gap-4 text-sm font-medium">
        <a className="underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${business.name}, ${address}`)}`} target="_blank" rel="noopener noreferrer">Get directions</a>
        {business.websiteUrl && <a className="underline" href={business.websiteUrl} target="_blank" rel="noopener noreferrer">Business website</a>}
      </div>
    </section>
    <article id="reference-post" className="space-y-4 rounded-2xl bg-stone-50 p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Reference post · {business.post.author}</p>
      <h2 className="text-2xl font-semibold">{business.post.title}</h2>
      <p className="leading-7 text-stone-700">{business.post.body}</p>
      <p className="text-xs text-stone-500">No licensed business photo is available for this listing.</p>
      <p className="text-xs text-stone-500">Collected {business.collectedOn} · <a href={business.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">{business.sourceType === "directory" ? "Public directory source" : "Business website source"}</a></p>
    </article>
  </main>;
}
