import {Fragment} from "react";
import {ExploreReferenceLove,ExploreBookButton} from "@/components/explore-account-actions";
import {ExploreAdSlot} from "@/components/explore-advertising";
import Form from "next/form";
import Link from "next/link";
import { directoryCollectedOn, searchWisconsinBusinesses, wisconsinBusinesses } from "@/lib/wisconsin-directory";
import { getDirectorySalonLinks } from "@/lib/salon-directory";

export const metadata = { title: "Wisconsin beauty directory | Reylumi" };
const pageSize = 24;
function single(value: string | string[] | undefined) { return (Array.isArray(value) ? value[0] : value) ?? ""; }

export default async function WisconsinDirectory({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = single(params.q).slice(0, 200);
  const category = ["All", "Nails", "Hair", "Massage"].includes(single(params.category)) ? single(params.category) : "All";
  const cities = [...new Set(wisconsinBusinesses.map((business) => business.city))].sort();
  const city = cities.includes(single(params.city)) ? single(params.city) : "All";
  const results = searchWisconsinBusinesses(query, category, city);
  const pages = Math.max(1, Math.ceil(results.length / pageSize));
  const requestedPage = Number(single(params.page));
  const page = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1));
  const visibleBusinesses = results.slice((page - 1) * pageSize, page * pageSize);
  const links = await getDirectorySalonLinks(visibleBusinesses.map((business) => business.id));
  function profileHref(listingId: string) {
    const link = links.get(listingId);
    return link ? `/explore/salons/${link.salonId}` : `/explore/wisconsin/${listingId}`;
  }
  function pageHref(target: number) {
    return `/explore/wisconsin?${new URLSearchParams({ q: query, category, city, page: String(target) })}`;
  }
  return <main className="mx-auto max-w-7xl space-y-7 px-5 py-8 sm:px-8">
    <Link href="/explore" className="text-sm font-medium text-stone-600 underline">← Explore</Link>
    <header className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">Wisconsin · Public directory</p>
      <h1 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">Find your next local beauty spot</h1>
      <p className="max-w-3xl text-stone-600">Browse nails, hair and massage businesses. Every listing includes an address, a phone number and a reference introduction. These businesses have not claimed or confirmed their listings.</p>
      <p className="text-sm text-stone-500">{wisconsinBusinesses.length} listings · {cities.length} cities · Collected {directoryCollectedOn}. Coverage is partial; confirm details with the business.</p>
      <a href="/api/explore/wisconsin/export" className="inline-block text-sm font-medium text-amber-800 underline">Download directory data (JSON)</a>
    </header>
    <Form className="grid gap-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-[1fr_160px_180px_auto]" action="/explore/wisconsin">
      <label className="text-sm font-medium">Search<input name="q" defaultValue={query} placeholder="Name, address or phone" className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-3" /></label>
      <label className="text-sm font-medium">Service<select name="category" defaultValue={category} className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-3">{["All", "Nails", "Hair", "Massage"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-sm font-medium">City<select name="city" defaultValue={city} className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-3"><option>All</option>{cities.map((item) => <option key={item}>{item}</option>)}</select></label>
      <button className="self-end rounded-lg bg-stone-900 px-6 py-3 font-medium text-white">Search</button>
    </Form>
    <p className="text-sm text-stone-600" role="status">{results.length} matching businesses</p>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Business listings">
      {visibleBusinesses.map((business,index) => <Fragment key={business.id}><article className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap gap-2 text-xs font-medium">{business.categories.map((item) => <span key={item} className="rounded-full bg-amber-50 px-3 py-1 text-amber-900">{item}</span>)}<span className="rounded-full bg-stone-100 px-3 py-1 text-stone-600">{links.get(business.id)?.claimState === "claimed" ? "Claimed" : "Unclaimed"}</span></div>
        <h2 className="text-xl font-semibold"><Link href={profileHref(business.id)} className="hover:underline">{business.name}</Link></h2>
        <div className="flex justify-between"><ExploreReferenceLove itemKey={`directory:${business.id}`} name={business.name}/><ExploreBookButton name={business.name} contactHref={profileHref(business.id)} phoneHref={`tel:+1${business.phone.replace(/\D/g, "")}`}/></div>
        <address className="text-sm not-italic text-stone-600">{business.address}<br />{business.city}, WI {business.postalCode}</address>
        <a className="text-lg font-semibold text-stone-900" href={`tel:+1${business.phone.replace(/\D/g, "")}`}>{business.phone}</a>
        <div className="min-h-5 break-all text-sm text-stone-600">{business.email ? <a href={`mailto:${business.email}`} className="underline">{business.email}</a> : <span aria-label="No public email available" />}</div>
        <Link href={profileHref(business.id)} className="mt-auto text-sm font-medium text-amber-800 underline">View business profile →</Link>
        <a href={business.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-stone-500 underline">Source: {business.sourceType === "directory" ? "public directory" : "business website"}</a>
      </article>{(index+1)%4===0?<ExploreAdSlot/>:null}</Fragment>)}
    </section>
    {results.length === 0 && <p className="rounded-xl bg-stone-50 p-6">No matching businesses. Try another city or service.</p>}
    <nav aria-label="Directory pagination" className="flex items-center justify-center gap-5 py-4">
      {page > 1 && <Link className="rounded-lg border px-4 py-2" href={pageHref(page - 1)}>Previous</Link>}
      <span className="text-sm">Page {page} of {pages}</span>
      {page < pages && <Link className="rounded-lg border px-4 py-2" href={pageHref(page + 1)}>Next</Link>}
    </nav>
  </main>;
}
