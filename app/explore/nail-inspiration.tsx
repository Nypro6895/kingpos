"use client";
import { ContentViewer } from "@/components/content-viewer";
import { LumiAiWatermark } from "@/components/nail-illustration-credit";

import { ExploreViewportImage as Image } from "./explore-viewport-image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ExploreBookButton, ExploreReferenceLove } from "@/components/explore-account-actions";
import { NAIL_FACETS, type NailFacet, type NailFilters, type NailLook } from "@/lib/nail-inspiration-catalog";
import { nailPhoneHref, nailSalonEligible, nailSalonHref, nailSalonSearchHref, nailSalonSearchInput, selectNailLooks, supportsNailInspiration } from "@/lib/nail-inspiration";
import { fetchExploreSearchPage } from "@/lib/explore-search-client";
import { referenceLoveStatesAction } from "@/app/explore/account-actions";
import type { ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import type { ExploreSearchResult } from "@/types/explore";
import { ExploreAutoLoad } from "@/app/explore/explore-auto-load";
import { rankRelatedNailLooks } from "@/lib/explore-reference-recommendations";
import { appendNailRecommendations, NAIL_INTEREST_EVENT, nailInterestStorageKey, normalizeNailViews, personalizeNailLooks, readNailViews, recordNailLookView, type NailLookView } from "@/lib/nail-inspiration-personalization";

const label = (value: string) => value === "3d" ? "3D art" : value.replace(/(^|[- ])\w/g, letter => letter.toUpperCase()).replaceAll("-", " ");

export function NailInspirationFilters({ filters, onChange }: { filters: NailFilters; onChange: (filters: NailFilters) => void }) {
  const activeCount = Object.values(filters).filter(Boolean).length;
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (panel.current?.open && event.target instanceof Node && !panel.current.contains(event.target)) panel.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !panel.current?.open) return;
      panel.current.open = false;
      panel.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, []);
  return <details ref={panel} className="relative justify-self-end">
    <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-full px-3 text-sm font-medium text-text-secondary hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-brand-orange [&::-webkit-details-marker]:hidden">
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h16M4 17h16M9 4v6M15 14v6" /></svg>
      Refine looks{activeCount ? <span className="rounded-full bg-brand-orange-soft px-2 text-brand-orange">{activeCount}</span> : null}
    </summary>
    <fieldset className="absolute right-0 top-full z-20 mt-1 grid w-[min(22rem,calc(100vw-3rem))] gap-2 rounded-2xl border border-divider-subtle bg-white p-4 shadow-lg" data-testid="nail-inspiration-filters">
    <legend className="sr-only">Refine nail inspiration</legend>
    <div className="flex flex-wrap items-center gap-2">
      {(Object.keys(NAIL_FACETS) as NailFacet[]).map(facet => <label key={facet} className="relative min-w-0">
        <span className="sr-only">Nail {facet}</span>
        <select aria-label={`Nail ${facet}`} value={filters[facet] ?? ""} onChange={event => onChange({ ...filters, [facet]: event.target.value })}
          className={`min-h-10 max-w-[10rem] rounded-full border px-3 pr-6 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-orange ${filters[facet] ? "border-brand-orange bg-brand-orange-soft text-brand-orange" : "border-divider-subtle bg-white text-text-secondary"}`}>
          <option value="">{label(facet)}</option>
          {NAIL_FACETS[facet].map(value => <option key={value} value={value}>{label(value)}</option>)}
        </select>
      </label>)}
      {Object.values(filters).some(Boolean) ? <button type="button" onClick={() => onChange({})} className="min-h-10 px-2 text-sm font-semibold text-brand-teal">Clear nail filters</button> : null}
    </div>
    </fieldset>
  </details>;
}

export function NailInspirationCard({ look, salon, location = "", initialSaved, onOpen }: { look: NailLook; salon?: ExploreSearchResult; location?: string; initialSaved?: boolean; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const phone = salon ? nailPhoneHref(salon.phone) : null;
  const tags = [look.colors[0], look.shape, look.length, look.finish];
  const detailHref = `/explore/inspiration/${look.id}${location ? `?location=${encodeURIComponent(location)}` : ""}`;
  const actions = salon ? <div className="flex flex-wrap items-center gap-2">
    <Link href={nailSalonHref(salon)} prefetch={false} className="inline-flex min-h-10 items-center rounded-full bg-brand-orange px-4 text-sm font-semibold text-white" aria-label={`View ${salon.name}`}>View salon</Link>
    {salon.bookingEnabled && salon.bookingHref ? <ExploreBookButton href={salon.bookingHref} name={salon.name} className="!min-h-10 !px-5 !text-sm" /> : <>
      {phone ? <a href={phone} className="inline-flex min-h-10 items-center rounded-full bg-brand-teal-soft px-4 text-sm font-semibold text-brand-teal" aria-label={`Call ${salon.name}`}>Call salon</a> : null}
    </>}
  </div> : <Link href={nailSalonSearchHref(location)} prefetch={false} className="inline-flex min-h-10 items-center rounded-full bg-brand-orange px-4 text-sm font-semibold text-white">Browse nail salons{location ? " in this area" : " nearby"}</Link>;
  return <article className="overflow-hidden rounded-2xl border border-divider-subtle bg-white" data-testid="nail-inspiration-post" data-nail-look={look.id} data-salon-id={salon?.id}>
    <div className="relative">
      <button ref={opener} type="button" onClick={() => { onOpen?.(); setOpen(true); }} aria-label={`View ${look.title}${salon ? ` near ${salon.name}` : ""}`} className="relative block aspect-[4/5] w-full bg-surface-muted focus-visible:outline-2 focus-visible:outline-brand-orange">
        <Image src={look.imageUrl} alt={look.alt} fill sizes="(max-width: 640px) 92vw, 600px" className="object-cover" />
        <LumiAiWatermark className="absolute bottom-3 right-3" />
      </button>
      <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">Inspiration</span>
      <div className="absolute right-3 top-3"><ExploreReferenceLove itemKey={`look:nail-${look.id}`} name={look.title} initialActive={initialSaved} className="!size-11 !text-2xl" /></div>
    </div>
    <div className="grid gap-3 p-4">
      <div><Link href={detailHref} prefetch={false} onClick={onOpen} className="text-base font-semibold text-text-primary">{look.title}</Link><p className="mt-1 text-xs text-text-secondary">{tags.map(label).join(" · ")}</p></div>
      {salon ? <div className="grid gap-3 border-t border-divider-subtle pt-3">
        <p className="text-xs font-medium text-text-secondary">A salon to discuss this look</p>
        <Link href={nailSalonHref(salon)} prefetch={false} className="flex min-w-0 items-center gap-2.5">
          <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-orange-soft text-xs font-bold text-brand-orange">
            {salon.logoImageUrl ? <Image src={salon.logoImageUrl} alt="" fill sizes="40px" className="object-cover" /> : salon.name.split(/\s+/).slice(0, 2).map(word => word[0]).join("")}
          </span>
          <span className="min-w-0"><span className="block break-words text-sm font-semibold">{salon.name}</span><span className="block text-xs text-text-secondary">{[salon.city, salon.state].filter(Boolean).join(", ")}{salon.distanceMiles != null ? ` · ${salon.distanceMiles.toFixed(1)} mi` : ""}</span></span>
        </Link>
        {actions}
      </div> : actions}
      <p className="text-[11px] leading-4 text-text-muted">AI inspiration by Reylumi · {salon ? "A nearby salon to discuss this look. Not a photo of this salon’s work." : "Save the look and discuss it with your nail artist."}</p>
    </div>
    {open ? <ContentViewer aria-label={look.title} onClose={() => setOpen(false)} className="place-items-center"><div className="m-auto w-[calc(100%_-_1.5rem)] max-w-lg overflow-y-auto rounded-3xl bg-white p-0 text-text-primary shadow-xl">
      <button type="button" onClick={() => setOpen(false)} autoFocus aria-label="Close nail look" className="absolute right-3 top-3 z-10 grid size-11 place-items-center rounded-full bg-white text-xl shadow">×</button>
      <div className="relative">
        <Image src={look.imageUrl} alt={look.alt} width={look.width} height={look.height} sizes="(max-width: 640px) 94vw, 500px" className="max-h-[55dvh] w-full object-cover" />
        <LumiAiWatermark className="absolute bottom-3 right-3" />
      </div>
      <div className="grid gap-3 p-5"><h2 className="text-xl font-semibold">{look.title}</h2><p className="text-sm text-text-secondary">{tags.map(label).join(" · ")}</p>
        {salon ? <p className="font-semibold">Discuss this look with {salon.name}</p> : null}{actions}
        <p className="text-xs leading-5 text-text-secondary">AI-generated reference design. Confirm the design, service and price with your salon before booking.</p>
        <Link href={detailHref} prefetch={false} onClick={onOpen} className="text-sm font-semibold text-brand-teal">Open this look</Link>
      </div>
    </div></ContentViewer> : null}
  </article>;
}

export function useNailInspiration(discovery: ExploreFeedDiscoveryOptions, filters: NailFilters, viewerId: string | null | undefined, anchor: RefObject<HTMLDivElement | null>, suppliedSalons?: ExploreSearchResult[], initialCount = 6, enabled = true) {
  const [seed, setSeed] = useState("reylumi");
  const [salonSnapshot, setSalonSnapshot] = useState<{ key: string; salons: ExploreSearchResult[] }>({ key: "", salons: [] });
  const [savedSnapshot, setSavedSnapshot] = useState<{ viewerId?: string | null; keys: string[] }>({ keys: [] });
  const savedKeys = savedSnapshot.viewerId === viewerId ? savedSnapshot.keys : [];
  const viewerKey = viewerId ?? "guest";
  const [interest, setInterest] = useState<{ key: string; views: NailLookView[] }>({ key: "", views: [] });
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const supported = enabled && supportsNailInspiration(discovery.category) && !discovery.trendingOnly;
  const exactCandidates = useMemo(() => supported ? selectNailLooks(discovery.query, filters, seed) : [], [discovery.query, filters, seed, supported]);
  const related = supported && exactCandidates.length === 0 && Boolean(discovery.query?.trim()) && !Object.values(filters).some(Boolean);
  const candidates = useMemo(() => related ? rankRelatedNailLooks(discovery.query ?? "", [], 1) : exactCandidates, [related, discovery.query, exactCandidates]);
  const looks = related ? candidates : personalizeNailLooks(candidates, savedKeys, interest.key === viewerKey ? interest.views : []);
  const canLoad = supported && looks.length > 0;
  // Only salon-affecting filters restart the location search. Image filters never query salon names.
  const salonInputKey = JSON.stringify({ input: nailSalonSearchInput(discovery), maxPrice: discovery.maxPrice, newOnly: discovery.newOnly, bookableOnly: discovery.bookableOnly });
  const salons = suppliedSalons ?? (salonSnapshot.key === salonInputKey ? salonSnapshot.salons : []);
  const selectionKey = JSON.stringify([viewerKey, seed, discovery.query, filters, salonInputKey, supported]);
  const [selection, setSelection] = useState<{ key: string; limit: number; looks: NailLook[] }>({ key: "", limit: initialCount, looks: [] });
  const current = selection.key === selectionKey ? selection : { key: selectionKey, limit: initialCount, looks: [] };
  // Reference designs remain useful even when no local salon is available.
  const visible = appendNailRecommendations(current.looks, looks, current.limit);
  if (selection.key !== selectionKey || visible.length > current.looks.length) {
    setSelection({ ...current, looks: visible });
  }
  const hasMore = visible.length > 0 && visible.length < looks.length;
  useEffect(() => {
    const load = () => setInterest({ key: viewerKey, views: readNailViews(viewerId) });
    const frame = requestAnimationFrame(load);
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ viewerId: string | null; views: NailLookView[] }>).detail;
      if (detail && detail.viewerId === (viewerId ?? null)) setInterest({ key: viewerKey, views: normalizeNailViews(detail.views) });
    };
    const stored = (event: StorageEvent) => { if (event.key === null || event.key === nailInterestStorageKey(viewerId)) load(); };
    window.addEventListener(NAIL_INTEREST_EVENT, changed);
    window.addEventListener("storage", stored);
    return () => { cancelAnimationFrame(frame); window.removeEventListener(NAIL_INTEREST_EVENT, changed); window.removeEventListener("storage", stored); };
  }, [viewerId, viewerKey]);
  useEffect(() => {
    let active = true;
    if (!viewerId || !supported) return;
    const overrides = new Map<string, boolean>();
    const allKeys = selectNailLooks().map(look => `look:nail-${look.id}`);
    const batches = Array.from({ length: Math.ceil(allKeys.length / 40) }, (_, index) => allKeys.slice(index * 40, (index + 1) * 40));
    void Promise.allSettled(batches.map(keys => referenceLoveStatesAction(keys))).then(results => {
      if (active) {
        const keys = new Set(results.flatMap(result => result.status === "fulfilled" && !result.value.error ? result.value.keys : []));
        overrides.forEach((saved, key) => { if (saved) keys.add(key); else keys.delete(key); });
        setSavedSnapshot({ viewerId, keys: [...keys] });
      }
    });
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; active: boolean }>).detail;
      if (detail?.key?.startsWith("look:nail-")) {
        overrides.set(detail.key, detail.active);
        setSavedSnapshot(snapshot => { const keys = snapshot.viewerId === viewerId ? snapshot.keys : []; return { viewerId, keys: detail.active ? [...new Set([...keys, detail.key])] : keys.filter(key => key !== detail.key) }; });
      }
    };
    window.addEventListener("reylumi:reference-favorite", changed);
    return () => { active = false; window.removeEventListener("reylumi:reference-favorite", changed); };
  }, [viewerId, supported]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try { const key = "reylumi:nail-inspiration:rotation"; let value = sessionStorage.getItem(key); if (!value) { value = crypto.randomUUID(); sessionStorage.setItem(key, value); } setSeed(value); } catch { setSeed(new Date().toISOString().slice(0, 10)); }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!canLoad || suppliedSalons !== undefined) return;
    const controller = new AbortController();
    let started = false;
    const config = JSON.parse(salonInputKey) as { input: ReturnType<typeof nailSalonSearchInput>; maxPrice?: number; newOnly?: boolean; bookableOnly?: boolean };
    const load = async () => {
      if (started || !anchor.current?.getClientRects().length) return;
      started = true; setStatus("loading"); setError(""); setSalonSnapshot({ key: salonInputKey, salons: [] });
      try {
        const response = await fetchExploreSearchPage(config.input, controller.signal);
        if (controller.signal.aborted) return;
        if (response.error) throw new Error(response.error);
        setSalonSnapshot({ key: salonInputKey, salons: response.results.filter(salon => nailSalonEligible(salon, config)) }); setStatus("ready");
      } catch (cause) { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "Nearby salons could not be loaded."); setStatus("error"); } }
    };
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void load(); }, { rootMargin: "600px" }) : null;
    if (observer && anchor.current) observer.observe(anchor.current); else void load();
    return () => { controller.abort(); observer?.disconnect(); };
  }, [salonInputKey, attempt, canLoad, anchor, suppliedSalons]);
  const loadMore = () => setSelection(value => value.key === selectionKey ? { ...value, limit: Math.max(value.limit, current.limit + 6) } : value);
  const posts = visible.map((look, index) => <div key={look.id} className="grid gap-3">
    {related && index === 0 ? <p className="text-sm font-semibold text-brand-teal">Similar ideas inspired by your search</p> : null}
    <NailInspirationCard look={look} salon={salons.length ? salons[index % salons.length] : undefined} location={discovery.location} initialSaved={savedKeys.includes(`look:nail-${look.id}`)} onOpen={() => recordNailLookView(look.id, viewerId)} />
  </div>);
  const footer = supported ? <div className="grid justify-items-center gap-2 py-3 text-center text-sm text-text-secondary" data-testid="nail-inspiration-status">
    {status === "loading" && canLoad ? <p role="status">Finding salons for your nail inspiration…</p> : null}
    {status === "error" && canLoad ? <><p role="status">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-10 rounded-full bg-surface-muted px-4 font-semibold">Retry nearby inspiration</button></> : null}
    {hasMore ? <div className="relative w-full" data-testid="nail-inspiration-load-more">
      <ExploreAutoLoad onLoad={loadMore} progressKey={visible.length} />
      <button type="button" onClick={loadMore} className="sr-only rounded-full bg-brand-orange-soft px-5 py-3 font-semibold text-brand-orange focus:not-sr-only">More nail inspiration</button>
    </div> : null}
  </div> : null;
  return { posts, footer, supported, hasMore, lookIds: visible.map(look => look.id) };
}

/** Browse/GPS search uses its already-ranked salon results, without another location request. */
export function NailSearchInspiration({ salons: results, discovery, viewerId }: { salons: ExploreSearchResult[]; discovery: ExploreFeedDiscoveryOptions; viewerId?: string | null }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<NailFilters>({});
  const salons = useMemo(() => results.filter(salon => nailSalonEligible(salon, discovery) && /nail|manicure|acrylic|pedicure/i.test([salon.name, ...salon.serviceCategories, ...salon.serviceNames].join(" "))), [results, discovery]);
  const nails = useNailInspiration(discovery, filters, viewerId, anchor, salons, 3);
  if (!nails.supported || !salons.length || !selectNailLooks(discovery.query).length) return null;
  return <section ref={anchor} className="grid gap-3" aria-label="Nail inspiration with salons in your search">
    <NailInspirationFilters filters={filters} onChange={setFilters} />
    <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">{nails.posts}</div>
    {nails.footer}
  </section>;
}
