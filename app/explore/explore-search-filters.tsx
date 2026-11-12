"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNativeDialogNavigation } from "@/components/overlay-dismissal";
import { useDialogViewport } from "@/components/use-dialog-viewport";
import { NAIL_FACETS, type NailFacet } from "@/lib/nail-inspiration-catalog";
import { exploreFilterCount } from "@/lib/explore-filter-state";
import { EXPLORE_CATEGORY_OPTIONS, type ExploreSearchFilters } from "@/types/explore";

type Props = { category: string; filters: ExploreSearchFilters; styleSearch: boolean; location: string; onApply: (category: string, filters: ExploreSearchFilters) => void };
const label = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function ExploreSearchFilters(props: Props) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useCallback(() => trigger.current?.focus({ preventScroll: true }), []);
  const count = exploreFilterCount(props.category, props.filters);
  return <>
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-elevated px-4 text-sm font-medium text-text-primary ring-1 ring-divider-subtle">
      Filters{count > 0 ? <span className="rounded-full bg-brand-orange-soft px-2 text-brand-orange">{count}</span> : null}
    </button>
    {open ? <FilterSheet {...props} onClose={() => setOpen(false)} onRestoreFocus={restoreFocus} /> : null}
  </>;
}

function FilterSheet({ category, filters, styleSearch, location, onApply, onClose, onRestoreFocus }: Props & { onClose: () => void; onRestoreFocus: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draftCategory, setCategory] = useState(category || "All");
  const [draft, setDraft] = useState<ExploreSearchFilters>({ ...filters });
  const [price, setPrice] = useState(filters.maxPrice === undefined ? "" : String(filters.maxPrice));
  useNativeDialogNavigation(dialog);
  useDialogViewport(dialog, true, "sheet");
  useEffect(() => {
    const element = dialog.current, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; onRestoreFocus(); };
  }, [onRestoreFocus]);
  const nailCategory = ["All", "Nails", "Manicure", "Pedicure", "Gel", "Acrylic", "Nail Art"].includes(draftCategory);
  const styleActive = Object.keys(NAIL_FACETS).some(key => Boolean(draft[key as NailFacet]));
  const inputClass = "mt-1 min-h-11 w-full rounded-xl border border-divider-subtle bg-white px-3 text-base text-text-primary";
  return createPortal(<dialog ref={dialog} aria-labelledby="explore-filters-title" data-testid="explore-filter-dialog"
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[85dvh] w-full max-w-md overflow-hidden rounded-t-3xl bg-white p-0 text-text-primary shadow-xl backdrop:bg-black/35 sm:inset-0 sm:m-auto sm:rounded-3xl">
    <form className="flex max-h-[inherit] flex-col" onSubmit={event => { event.preventDefault(); onApply(draftCategory, { ...draft, maxPrice: price.trim() === "" ? undefined : Number(price) }); onClose(); }}>
      <header className="flex shrink-0 items-center justify-between border-b border-divider-subtle px-5 py-2">
        <div><h2 id="explore-filters-title" className="text-lg font-semibold">Filters</h2><p className="text-xs text-text-secondary">{location ? `Searching in ${location}` : "Searching anywhere"}</p></div>
        <button type="button" aria-label="Close filters" onClick={onClose} className="grid size-11 place-items-center rounded-full text-xl">×</button>
      </header>
      <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
        <label className="block text-sm font-medium">Service
          <select aria-label="Service category" className={inputClass} value={draftCategory} onChange={event => setCategory(event.target.value)}>
            {[...new Set([...EXPLORE_CATEGORY_OPTIONS, category])].filter(Boolean).map(value => <option key={value} value={value}>{value === "All" ? "All services" : value}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Maximum service price ($)
          <input aria-label="Maximum service price" type="number" inputMode="decimal" min="0" max="100000" step="0.01" value={price} placeholder="Any price" onChange={event => setPrice(event.target.value)} className={inputClass} />
        </label>
        {(["bookableOnly", "newOnly", "trendingOnly"] as const).filter(key => draft[key]).map(key => <button type="button" key={key} className="min-h-11 rounded-full bg-surface-muted px-3 text-sm" onClick={() => setDraft({ ...draft, [key]: false })}>Remove {key === "bookableOnly" ? "online booking only" : key === "newOnly" ? "new salons only" : "trending only"} ×</button>)}
        {(nailCategory || styleActive) ? <details open={styleSearch || styleActive || undefined} className="rounded-xl border border-divider-subtle p-3">
          <summary className="cursor-pointer text-sm font-medium">Nail style <span className="font-normal text-text-secondary">(optional)</span></summary>
          <div className="mt-3 grid grid-cols-2 gap-3">{(Object.keys(NAIL_FACETS) as NailFacet[]).map(facet => <label key={facet} className="min-w-0 text-sm">{label(facet)}<select aria-label={`Nail ${facet}`} className={inputClass} value={draft[facet] || ""} onChange={event => setDraft({ ...draft, [facet]: event.target.value })}><option value="">Any</option>{NAIL_FACETS[facet].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>)}</div>
        </details> : null}
        <button type="button" className="min-h-11 text-sm font-semibold text-brand-teal" onClick={() => { setCategory("All"); setDraft({}); setPrice(""); }}>Clear filters</button>
      </div>
      <footer className="flex shrink-0 gap-3 border-t border-divider-subtle p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-full bg-surface-muted text-sm font-semibold">Cancel</button>
        <button type="submit" className="min-h-11 flex-1 rounded-full bg-brand-orange text-sm font-semibold text-white">Apply filters</button>
      </footer>
    </form>
  </dialog>, document.body);
}
